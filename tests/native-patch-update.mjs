import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const [bundleArg,baselineArg,testExeArg,outArg,overlayArg]=process.argv.slice(2);
const bundle=path.resolve(bundleArg),baseline=path.resolve(baselineArg),out=path.resolve(outArg);
const manifest=JSON.parse(await fs.readFile(path.join(path.dirname(bundle),'patch-manifest.json'),'utf8'));
const fixture=path.join(out,'installation'), executable=path.join(bundle,'Update-Test.exe');
await fs.mkdir(fixture,{recursive:true});await fs.copyFile(testExeArg,executable);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=[...new Set([...manifest.changed.map(file=>file.name),...Object.keys(manifest.retained)])];
const snapshot={};
for(const name of files) {
  let source=path.join(baseline,name);
  if(overlayArg){const overlay=path.join(path.resolve(overlayArg),name);try{await fs.access(overlay);source=overlay;}catch{}}
  const bytes=await fs.readFile(source);snapshot[name]=hash(bytes);
  const target=path.join(fixture,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);
}
await fs.writeFile(path.join(fixture,'xiaoma-install.id'),manifest.marker);
await fs.mkdir(path.join(fixture,'data'),{recursive:true});await fs.writeFile(path.join(fixture,'data','tasks.json'),'user task fixture');
const run=(target=fixture,env={},extra=[])=>spawnSync(executable,['--target',target,...extra],{encoding:'utf8',windowsHide:true,timeout:60000,env:{...process.env,...env}});
const verifyBaseline=async()=>{for(const [name,digest] of Object.entries(snapshot))assert.equal(hash(await fs.readFile(path.join(fixture,name))),digest,name);};
try {
  for(const failAfter of [1,4,manifest.changed.length]) {
    const result=run(fixture,{XM_PATCH_FAIL_AFTER:String(failAfter)});assert.equal(result.status,1,result.stdout+result.stderr);
    assert.match(result.stderr,/Injected update failure/);await verifyBaseline();
  }
  const payload=path.join(bundle,'payload',manifest.changed[0].name), original=await fs.readFile(payload);
  try {
    await fs.appendFile(payload,'tamper');const result=run();assert.equal(result.status,1);assert.match(result.stderr,/校验/);await verifyBaseline();
  } finally {await fs.writeFile(payload,original);}
  const declined=run(fixture+'-missing');assert.equal(declined.status,1);
  const before=await fs.readFile(path.join(fixture,manifest.changed[1].name));
  await fs.appendFile(path.join(fixture,manifest.changed[1].name),'unknown local change');
  const mixed=run();assert.equal(mixed.status,1);assert.match(mixed.stderr,/混用或修改/);
  await fs.writeFile(path.join(fixture,manifest.changed[1].name),before);await verifyBaseline();
  const mixedFile=manifest.changed.find(file=>file.name!=='native-files.json'&&file.name!=='小马剪辑台.exe'&&snapshot[file.name]!==file.after);
  assert(mixedFile,'Fixture must precede the new revision');
  const mixedPath=path.join(fixture,mixedFile.name),mixedBefore=await fs.readFile(mixedPath);
  await fs.copyFile(path.join(bundle,'payload',mixedFile.name),mixedPath);
  const knownMixture=run();assert.equal(knownMixture.status,1);assert.match(knownMixture.stderr,/混用或修改/);
  await fs.writeFile(mixedPath,mixedBefore);await verifyBaseline();
  const verify=run(fixture,{},['--verify-only']);assert.equal(verify.status,0,verify.stderr);await verifyBaseline();
  const success=run();assert.equal(success.status,0,success.stdout+success.stderr);
  for(const file of manifest.changed)assert.equal(hash(await fs.readFile(path.join(fixture,file.name))),file.after,file.name);
  for(const [name,digest] of Object.entries(manifest.retained))assert.equal(hash(await fs.readFile(path.join(fixture,name))),digest,name);
  assert.equal(await fs.readFile(path.join(fixture,'data','tasks.json'),'utf8'),'user task fixture');
  const repeat=run();assert.equal(repeat.status,0,repeat.stderr);assert.match(repeat.stdout,/无需重复/);
  const report={passed:true,fromVersion:JSON.parse(await fs.readFile(path.join(overlayArg||baseline,'native-files.json'),'utf8')).version,changedFiles:manifest.changed.length,retainedFiles:Object.keys(manifest.retained).length,checks:['rollback-first','rollback-middle','rollback-last','corrupt-payload','missing-install','unknown-file','known-build-mixture','verify-only','upgrade','repeat','preserve-user-data']};
  await fs.writeFile(path.join(out,'test-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await fs.rm(executable,{force:true});}
