import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getRawHeader } from '@electron/asar';
import { NtExecutable, NtExecutableResource } from 'resedit';

const [sourceExe, asarPath, outputExe] = process.argv.slice(2);
if (!sourceExe || !asarPath || !outputExe) {
  throw new Error('Usage: node scripts/refresh-asar-integrity.mjs source.exe app.asar output.exe');
}

const { headerString } = await getRawHeader(asarPath);
const hash = createHash('sha256').update(headerString).digest('hex');
const executable = NtExecutable.from(await readFile(sourceExe));
const resources = NtExecutableResource.from(executable);
const entries = resources.entries.filter(item => item.type === 'INTEGRITY' && item.id === 'ELECTRONASAR');
if (entries.length !== 1) throw new Error('Expected one Electron ASAR integrity resource');
const integrity = JSON.parse(Buffer.from(entries[0].bin).toString('utf8'));
if (!Array.isArray(integrity) || integrity.length !== 1 ||
    integrity[0].file !== 'resources\\app.asar' || integrity[0].alg !== 'SHA256' ||
    !/^[a-f0-9]{64}$/i.test(integrity[0].value)) {
  throw new Error('Unexpected Electron ASAR integrity format');
}
integrity[0].value = hash;
const bytes = Buffer.from(JSON.stringify(integrity), 'utf8');
entries[0].bin = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
resources.outputResource(executable);
await writeFile(outputExe, Buffer.from(executable.generate()));

const verified = NtExecutableResource.from(NtExecutable.from(await readFile(outputExe)))
  .entries.find(item => item.type === 'INTEGRITY' && item.id === 'ELECTRONASAR');
if (JSON.parse(Buffer.from(verified.bin).toString('utf8'))[0].value !== hash) {
  throw new Error('Updated executable failed integrity resource verification');
}
console.log(`Updated Electron ASAR header integrity: ${hash}`);
