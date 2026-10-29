import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';

const sdk=process.env.XM_WEBVIEW2_TEST_DLL_DIR;
const skip=process.platform!=='win32'||(!sdk&&'Set XM_WEBVIEW2_TEST_DLL_DIR to the WebView2 SDK lib/net462 folder to run native integration tests');
async function verify(sources,main){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'xm-native-ui-'));
  try {
    for(const file of ['Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll'])await fs.copyFile(path.join(sdk,file),path.join(directory,file));
    const exe=path.join(directory,'verify.exe');
    const refs=['System.dll','System.Core.dll','System.Drawing.dll','System.Windows.Forms.dll','System.Web.Extensions.dll','System.Net.Http.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll',...['Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll'].map(file=>path.join(directory,file))];
    const compile=spawnSync(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/utf8output','/codepage:65001','/platform:x64','/out:'+exe,'/main:'+main,...refs.map(ref=>'/reference:'+ref),...sources.map(file=>path.resolve(file))],{encoding:'utf8',windowsHide:true});
    assert.equal(compile.status,0,compile.stdout+compile.stderr);
    const run=spawnSync(exe,[],{encoding:'utf8',windowsHide:true,timeout:20000});
    assert.equal(run.status,0,run.stdout+run.stderr);
  } finally {await fs.rm(directory,{recursive:true,force:true});}
}
test('native shortcut drops persist atomically and preserve existing entries and settings',{skip},async()=>{
  const files=(await fs.readdir('app/native-host')).filter(file=>file.endsWith('.cs')).map(file=>'app/native-host/'+file);
  await verify([...files,'tests/NativeMusicLibraryIntegration.cs'],'NativeMusicLibraryIntegration');
});
test('native official AI browser clips all corners and retains its handle across layout changes',{skip},async()=>{
  await verify(['app/native-host/RoundedWebView.cs','tests/NativeRoundedWebViewTests.cs'],'NativeRoundedWebViewTests');
});
