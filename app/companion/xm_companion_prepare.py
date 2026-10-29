"""Verify and adapt an upstream portable release without replacing user data."""
import hashlib
import json
import marshal
from pathlib import Path, PurePosixPath
import re
import shutil
import struct
import sys
import zipfile
import zlib

ENTRY = '''import sys, os, pathlib, traceback
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


def sha(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def patch_entry(binary):
    pos = binary.rindex(b'MEI\x0c\x0b\x0a\x0b\x0e')
    magic, length, offset, toc_length, version, dll = struct.unpack('!8sIIII64s', binary[pos:pos + 88])
    if version != sys.version_info.major * 100 + sys.version_info.minor:
        raise ValueError('新版桌宠运行环境已变化，请先更新 XM剪辑台以获得适配支持。')
    start = pos + 88 - length
    table = binary[start + offset:start + offset + toc_length]
    replacement = marshal.dumps(compile(ENTRY, 'xm_companion_entry.py', 'exec'))
    payload, entries, cursor, replaced = bytearray(), [], 0, 0
    while cursor < len(table):
        entry_size, index, size, plain, compressed, kind = struct.unpack('!IIIIBc', table[cursor:cursor + 18])
        if entry_size < 19 or cursor + entry_size > len(table):
            raise ValueError('桌宠程序索引无效')
        name = table[cursor + 18:cursor + entry_size].rstrip(b'\0')
        data = binary[start + index:start + index + size]
        if name == b'pet_entry' and kind == b's':
            data, plain, compressed = zlib.compress(replacement, 9), len(replacement), 1
            replaced += 1
        entries.append((len(payload), len(data), plain, compressed, kind, name))
        payload.extend(data)
        cursor += entry_size
    if replaced != 1:
        raise ValueError('新版桌宠入口已变化，请先更新 XM剪辑台。')
    new_table = bytearray()
    for index, size, plain, compressed, kind, name in entries:
        entry_size = (18 + len(name) + 16) // 16 * 16
        new_table.extend(struct.pack('!IIIIBc', entry_size, index, size, plain, compressed, kind))
        new_table.extend(name + b'\0' * (entry_size - 18 - len(name)))
    cookie = struct.pack('!8sIIII64s', magic, len(payload) + len(new_table) + 88, len(payload), len(new_table), version, dll)
    return binary[:start] + payload + new_table + cookie


def prepare(request):
    archive, dest, previous = (Path(request[key]).resolve() for key in ('archive', 'destination', 'previous'))
    if not re.fullmatch(r'\d+\.\d+\.\d+', request['version']):
        raise ValueError('无效版本号')
    if sha(archive) != request['sha256']:
        raise ValueError('桌宠更新包校验失败，请重新下载。')
    if dest.exists():
        raise ValueError('更新暂存目录已存在')
    with zipfile.ZipFile(archive) as package:
        names = set()
        total = 0
        for item in package.infolist():
            name = item.filename.replace('\\', '/')
            parts = PurePosixPath(name).parts
            total += item.file_size
            if (not parts or name.startswith('/') or '..' in parts or ':' in name
                    or not (dest / name).resolve().is_relative_to(dest)
                    or ((item.external_attr >> 16) & 0o170000) == 0o120000
                    or total > 4 * 1024**3 or name.lower() in names):
                raise ValueError('更新包包含不安全或重复路径')
            names.add(name.lower())
        binary = package.read('dsh-pet-standalone-webm-chat.exe')
        adapted = patch_entry(binary)  # Check compatibility before extracting.
        package.extractall(dest)
    exe = dest / 'dsh-pet-standalone-webm-chat.exe'
    exe.write_bytes(adapted)
    for name in ('xm_companion_bridge.py', 'xm_companion_prepare.py'):
        shutil.copyfile(Path(__file__).with_name(name), dest / '_internal' / name)
    # New portable releases can ship fewer animations. Retain all installed
    # character resources, while preferring files supplied by the new release.
    assets = dest / '_internal/assets/characters'
    old_assets = previous / '_internal/assets/characters'
    for file in old_assets.rglob('*'):
        target = assets / file.relative_to(old_assets)
        if file.is_file() and not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, target)
    clips = [{'id': file.relative_to(assets).as_posix(), 'name': file.stem,
              'category': file.parent.name, 'sha256': sha(file)} for file in sorted(assets.rglob('*.webm'))]
    if not clips or not any(item['category'] == 'idle' for item in clips):
        raise ValueError('更新缺少桌宠动画')
    manifest = {'version': request['version'], 'source': 'https://github.com/MerZlin/dsh-pet-indesktop',
                'archiveSha256': request['sha256'], 'executableSha256': sha(exe),
                'bridgeSha256': sha(dest / '_internal/xm_companion_bridge.py'),
                'prepareSha256': sha(dest / '_internal/xm_companion_prepare.py'), 'animations': clips}
    (dest / 'xm-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return manifest


def main(request_file):
    request = json.loads(Path(request_file).read_text(encoding='utf-8'))
    manifest = prepare(request)
    Path(request_file).with_suffix('.result.json').write_text(json.dumps({'ok': True, 'version': manifest['version']}), encoding='utf-8')
