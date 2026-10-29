import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getRawHeader } from '@electron/asar';

// Input is a local audited inventory, never user profiles or downloaded instructions.
// Output must be new; this script never recursively clears a directory.
const inventory = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const revision = inventory.revision || '20261026-fork-compat';
if (!/^[a-z0-9-]{1,80}$/.test(revision)) throw new Error('Invalid incremental revision');
const output = path.resolve(process.argv[3]);
await fs.mkdir(output);
await fs.mkdir(path.join(output, 'patches'));
await fs.mkdir(path.join(output, 'blocks'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const names = ['小马剪辑台.exe', 'resources\\app.asar', 'resources\\helpers\\PeriodKeeper.exe'];
const targetFiles = new Map(await Promise.all(names.map(async name => [name, await fs.readFile(path.join(inventory.target, name))])));
function ranges(file) {
  const { header, headerSize } = getRawHeader(file), values = [];
  function walk(tree) {
    for (const item of Object.values(tree.files || {})) {
      if (item.files) walk(item);
      else if (!item.unpacked && item.size > 0) values.push({ start: 8 + headerSize + Number(item.offset), size: item.size, hash: item.integrity.hash });
    }
  }
  walk(header); return values.sort((a, b) => a.start - b.start);
}
function makePatch(before, after, matched) {
  const pieces = [Buffer.from('XMPATCH1')], reconstructed = [];
  const copy = (offset, size) => { if (!size) return; const header = Buffer.alloc(13); header[0] = 0; header.writeBigInt64LE(BigInt(offset), 1); header.writeInt32LE(size, 9); pieces.push(header); reconstructed.push(before.subarray(offset, offset + size)); };
  const literal = bytes => { if (!bytes.length) return; const header = Buffer.alloc(5); header[0] = 1; header.writeInt32LE(bytes.length, 1); pieces.push(header, bytes); reconstructed.push(bytes); };
  if (matched) {
    let at = 0;
    for (const item of matched) {
      // ASAR may deduplicate identical files at the same offset.
      if (item.target < at) { if (item.target + item.size > at) throw new Error('Overlapping ranges'); continue; }
      literal(after.subarray(at, item.target)); copy(item.source, item.size); at = item.target + item.size;
    }
    literal(after.subarray(at));
  } else if (before.length === after.length) {
    let at = 0;
    while (at < after.length) {
      const start = at;
      if (before[at] === after[at]) { while (at < after.length && before[at] === after[at]) at++; copy(start, at - start); }
      else { let same = 0; at++; while (at < after.length) { same = before[at] === after[at] ? same + 1 : 0; at++; if (same >= 64) { at -= same; break; } } literal(after.subarray(start, at)); }
    }
  } else {
    let prefix = 0, suffix = 0;
    while (prefix < Math.min(before.length, after.length) && before[prefix] === after[prefix]) prefix++;
    while (suffix < Math.min(before.length, after.length) - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
    copy(0, prefix); literal(after.subarray(prefix, after.length - suffix)); copy(before.length - suffix, suffix);
  }
  if (!Buffer.concat(reconstructed).equals(after)) throw new Error('Delta reconstruction mismatch');
  return Buffer.concat(pieces);
}
const blocks = new Map();
async function shareLiterals(patch) {
  const pieces = [Buffer.from('XMPATCH2')]; let at = 8, outputAt = 0;
  while (at < patch.length) {
    const op = patch[at], headSize = op === 0 ? 13 : 5, size = patch.readInt32LE(at + (op === 0 ? 9 : 1));
    if (op === 0) { pieces.push(patch.subarray(at, at + headSize)); at += headSize; outputAt += size; continue; }
    at += headSize;
    if (size < 65536) { pieces.push(patch.subarray(at - headSize, at + size)); at += size; outputAt += size; continue; }
    let remaining = size;
    while (remaining) {
      // Anchor block boundaries in the final file so different baselines share identical data.
      const count = Math.min(remaining, 1048576 - outputAt % 1048576), bytes = patch.subarray(at, at + count), hash = sha(bytes);
      if (!blocks.has(hash)) { const name = `blocks\\${hash}.bin`; await fs.writeFile(path.join(output, name), bytes); blocks.set(hash, { name, hash, bytes: count }); }
      const header = Buffer.alloc(37); header[0] = 2; Buffer.from(hash, 'hex').copy(header, 1); header.writeInt32LE(count, 33); pieces.push(header);
      at += count; outputAt += count; remaining -= count;
    }
  }
  return Buffer.concat(pieces);
}
const bundle = { product: 'XM剪辑台', version: '1.3.1', revision, files: names.map(name => ({ name, hash: sha(targetFiles.get(name)), bytes: targetFiles.get(name).length })), runtime: [], blocks: [], variants: [] };
for (const name of inventory.names.filter(name => !names.includes(name))) {
  const bytes = await fs.readFile(path.join(inventory.target, name));
  if (sha(bytes) !== inventory.hashes[name]) throw new Error('Audited target changed: ' + name);
  bundle.runtime.push({ name, hash: sha(bytes) });
}
const cache = new Map(), variantKeys = new Set(), sourceMap = [];
for (const source of inventory.sources) {
  if (!['1.3.0', '1.3.1'].includes(source.version) || source.missing.length || source.different.some(name => !names.includes(name))) throw new Error('Baseline needs more than the approved incremental file set');
  const variant = { id: source.id, fromVersion: source.version, files: [] };
  for (const name of names) {
    const oldFile = path.join(source.source, name), nextFile = path.join(inventory.target, name);
    const before = await fs.readFile(oldFile), after = targetFiles.get(name), beforeHash = sha(before), afterHash = sha(after);
    let entry = cache.get(name + beforeHash);
    if (!entry) {
      let matched;
      if (name.endsWith('.asar')) {
        const known = new Map(ranges(oldFile).map(item => [item.hash, item]));
        matched = ranges(nextFile).flatMap(item => { const previous = known.get(item.hash); return previous && previous.size === item.size && before.subarray(previous.start, previous.start + previous.size).equals(after.subarray(item.start, item.start + item.size)) ? [{ source: previous.start, target: item.start, size: item.size }] : []; });
      }
      const patch = await shareLiterals(makePatch(before, after, matched)), patchHash = sha(patch), file = `patches\\${patchHash}.bin`;
      await fs.writeFile(path.join(output, file), patch);
      entry = { name, beforeHash, afterHash, patch: file, patchHash, bytes: after.length };
      cache.set(name + beforeHash, entry);
    }
    variant.files.push(entry);
  }
  // Recheck all unchanged runtime files; only validated identical engines are reused.
  for (const file of bundle.runtime) if (sha(await fs.readFile(path.join(source.source, file.name))) !== file.hash) throw new Error('Baseline runtime changed: ' + source.id + '/' + file.name);
  const key = variant.files.map(file => file.beforeHash).join('/');
  if (!variantKeys.has(key)) { variantKeys.add(key); bundle.variants.push(variant); }
  sourceMap.push({ id: source.id, source: source.source, variant: bundle.variants.find(item => item.files.map(file => file.beforeHash).join('/') === key).id });
  console.log('Verified delta', source.id);
}
bundle.blocks = [...blocks.values()];
const manifest = JSON.stringify(bundle, null, 2);
await fs.writeFile(path.join(output, 'manifest.json'), manifest);
await fs.writeFile(path.join(path.dirname(output), 'IncrementalManifestHash.cs'), `static class IncrementalManifestHash { public const string Value = "${sha(manifest)}"; }\n`);
await fs.writeFile(path.join(path.dirname(output), 'source-map.json'), JSON.stringify(sourceMap, null, 2));
console.log(JSON.stringify({ output, uniqueBaselines: bundle.variants.length, uniquePatches: new Set([...cache.values()].map(item => item.patch)).size, runtimeFilesReused: bundle.runtime.length }));
