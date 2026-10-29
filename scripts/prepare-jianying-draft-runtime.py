"""Cache an installed 11.6.5 DraftIO dependency set locally, without distributing it.

Developer tool; requires pefile. It never modifies Jianying or the sample draft.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid

import pefile


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def dependencies(source):
    queue = ['videoeditor.dll']
    found = {}
    while queue:
        name = queue.pop()
        if Path(name).name != name:
            raise ValueError('Invalid import filename')
        file = source / name
        if name.lower() in found or not file.is_file():
            continue
        if file.is_symlink():
            raise ValueError('Symbolic links are not supported')
        found[name.lower()] = file
        pe = pefile.PE(str(file), fast_load=True)
        try:
            pe.parse_data_directories(directories=[1, 13])
            for entry in list(getattr(pe, 'DIRECTORY_ENTRY_IMPORT', [])) + list(getattr(pe, 'DIRECTORY_ENTRY_DELAY_IMPORT', [])):
                queue.append(entry.dll.decode('ascii'))
        finally:
            pe.close()
    return sorted(found.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--engine', required=True, type=Path)
    parser.add_argument('--sample', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path, help='Installation data/draft-compat/11.6.5.14523 directory')
    args = parser.parse_args()
    source, engine, sample, output = (p.resolve() for p in (args.source, args.engine, args.sample, args.output))
    if source.name != '11.6.5.14523' or not (source / 'videoeditor.dll').is_file():
        raise ValueError('Only the verified 11.6.5.14523 interface is supported')
    if output.exists():
        raise FileExistsError('Compatibility directory already exists; inspect instead of overwriting')
    files = dependencies(source)
    if not files or not sample.is_file() or not engine.is_file():
        raise ValueError('Missing engine, sample or dependencies')
    stage = output.with_name('.preparing-' + uuid.uuid4().hex)
    stage.mkdir(parents=True)
    manifest = {}
    for file in files:
        target = stage / file.name
        shutil.copy2(file, target)
        checksum = digest(file)
        if digest(target) != checksum:
            raise ValueError('Copied component checksum mismatch: ' + file.name)
        manifest[file.name] = {'sha256': checksum, 'size': target.stat().st_size}
    before = digest(sample)
    worker = subprocess.run([str(engine), '--draft-io-native', 'read', str(sample), str(stage / 'videoeditor.dll')],
                            capture_output=True, timeout=50, creationflags=subprocess.CREATE_NO_WINDOW)
    response = next((json.loads(line) for line in reversed(worker.stdout.decode('utf-8-sig').splitlines())
                     if line.startswith('{"data":') or line.startswith('{"error":')), None)
    if digest(sample) != before:
        raise RuntimeError('Read-only sample changed during verification')
    if worker.returncode or not response or 'data' not in response:
        raise RuntimeError('Compatibility runtime read failed: ' + str(response and response.get('error')))
    report = {'version': source.name, 'source': str(source), 'files': manifest,
              'verifiedSchema': response['data'].get('new_version'), 'sampleUnchanged': True}
    (stage / 'runtime.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    stage.rename(output)
    print(json.dumps({'directory': str(output), 'files': len(files),
                      'bytes': sum(f['size'] for f in manifest.values()), 'sampleReadable': True}, ensure_ascii=False))


if __name__ == '__main__':
    main()
