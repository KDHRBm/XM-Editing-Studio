import fs from 'node:fs/promises';
import path from 'node:path';
const profile = path.resolve(process.env.XM_NATIVE_QA_PROFILE || '.generated/native-qa/profile');
const id = crypto.randomUUID();
const command = ['screenshot','screen','quit','progress','native','shape','window','sizing','pet-drop'].includes(process.argv[2]) ? process.argv[2] : 'script';
const script = process.argv[2] === 'file' ? await fs.readFile(process.argv[3], 'utf8') : process.argv[2];
await fs.writeFile(path.join(profile, 'qa-command.tmp'), JSON.stringify({ id, command, script, panel: process.argv.includes('--panel'),progress:process.argv.includes('--progress'), ...(command==='progress'?{state:JSON.parse(process.argv[3])}:['native','window','sizing','pet-drop'].includes(command)?JSON.parse(process.argv[3] || '{}'):{}) }));
await fs.rename(path.join(profile, 'qa-command.tmp'), path.join(profile, 'qa-command.json'));
for (let i = 0; i < 350; i++) {
  await new Promise(resolve => setTimeout(resolve, 100));
  try { const result = JSON.parse(await fs.readFile(path.join(profile, 'qa-result.json'), 'utf8')); if (result.id === id) { console.log(JSON.stringify(['screenshot','screen'].includes(command) && !result.value?.error ? { image: path.join(profile, id + '.png') } : result.value || result)); process.exit(result.value?.error ? 1 : 0); } } catch {}
}
throw Error('Native QA timed out');
