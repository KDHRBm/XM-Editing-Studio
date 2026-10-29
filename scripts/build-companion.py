"""Adapt the verified upstream onedir bundle; run with Python 3.11.

No upstream modules or media are stripped. Only the entry script gains the XM
bridge; the original Python archive and dependency resources remain unchanged.
"""
import hashlib
import json
import marshal
from pathlib import Path
import shutil
import struct
import sys
import zipfile
import zlib

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / '.generated/pet-download/dsh-pet-standalone-webm-chat-portable.zip'
EXPECTED = '333ea3ae7b319249ccb811157491252441d7a8b598e24557cfec61e14950cd64'
DEST = ROOT / 'app/build/companion'
assert sys.version_info[:2] == (3, 11), 'Use Python 3.11 to match upstream bytecode.'
assert hashlib.sha256(ARCHIVE.read_bytes()).hexdigest() == EXPECTED, 'Upstream archive checksum mismatch'
with zipfile.ZipFile(ARCHIVE) as archive:
    if not (DEST / '_internal/python311.dll').exists():
        assert all((DEST / item).resolve().is_relative_to(DEST.resolve()) for item in archive.namelist())
        archive.extractall(DEST)
    binary = archive.read('dsh-pet-standalone-webm-chat.exe')
cookie_pos = binary.rindex(b'MEI\x0c\x0b\x0a\x0b\x0e')
magic, length, offset, toc_length, version, dll = struct.unpack('!8sIIII64s', binary[cookie_pos:cookie_pos + 88])
assert version == 311
start = cookie_pos + 88 - length
table = binary[start + offset:start + offset + toc_length]
entry_source = '''import sys, os, pathlib, traceback
try:
    from xm_companion_bridge import install
    if not install():
        sys.exit(0)
    from pet.__main__ import _main
    sys.exit(_main())
except Exception:
    root = pathlib.Path(os.environ.get('XM_COMPANION_DATA', '.'))
    root.mkdir(parents=True, exist_ok=True)
    (root / 'companion-startup-error.txt').write_text(traceback.format_exc(), encoding='utf-8')
    raise
'''
replacement = marshal.dumps(compile(entry_source, 'xm_companion_entry.py', 'exec'))
payload, entries, cursor, replaced = bytearray(), [], 0, 0
while cursor < len(table):
    entry_size, pos, size, plain, compressed, kind = struct.unpack('!IIIIBc', table[cursor:cursor + 18])
    name = table[cursor + 18:cursor + entry_size].rstrip(b'\0')
    data = binary[start + pos:start + pos + size]
    if name == b'pet_entry' and kind == b's':
        data, plain, compressed = zlib.compress(replacement, 9), len(replacement), 1
        replaced += 1
    entries.append((len(payload), len(data), plain, compressed, kind, name))
    payload.extend(data)
    cursor += entry_size
assert replaced == 1
new_table = bytearray()
for pos, size, plain, compressed, kind, name in entries:
    entry_size = (18 + len(name) + 1 + 15) // 16 * 16
    new_table.extend(struct.pack('!IIIIBc', entry_size, pos, size, plain, compressed, kind))
    new_table.extend(name + b'\0' * (entry_size - 18 - len(name)))
cookie = struct.pack('!8sIIII64s', magic, len(payload) + len(new_table) + 88, len(payload), len(new_table), version, dll)
exe = DEST / 'dsh-pet-standalone-webm-chat.exe'
exe.write_bytes(binary[:start] + payload + new_table + cookie)
shutil.copyfile(ROOT / 'app/companion/xm_companion_bridge.py', DEST / '_internal/xm_companion_bridge.py')
shutil.copyfile(ROOT / 'app/companion/xm_companion_prepare.py', DEST / '_internal/xm_companion_prepare.py')
assets = DEST / '_internal/assets/characters'
clips = [{'id': str(file.relative_to(assets)).replace('\\', '/'), 'name': file.stem,
          'category': file.parent.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
         for file in sorted(assets.rglob('*.webm'))]
assert len(clips) == 106
with zipfile.ZipFile(ARCHIVE) as archive:
    for clip in clips:
        assert hashlib.sha256(archive.read('_internal/assets/characters/' + clip['id'])).hexdigest() == clip['sha256'], 'Original animation changed: ' + clip['id']
manifest = {'version': '4.3.4', 'source': 'https://github.com/MerZlin/dsh-pet-indesktop',
            'commit': '5d56d29', 'archiveSha256': EXPECTED,
            'executableSha256': hashlib.sha256(exe.read_bytes()).hexdigest(),
            'prepareSha256': hashlib.sha256((DEST / '_internal/xm_companion_prepare.py').read_bytes()).hexdigest(),
            'bridgeSha256': hashlib.sha256((DEST / '_internal/xm_companion_bridge.py').read_bytes()).hexdigest(), 'animations': clips}
(DEST / 'xm-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'animations': len(clips), 'executableSha256': manifest['executableSha256']}))
