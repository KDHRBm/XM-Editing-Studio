from pathlib import Path
from importlib.metadata import distribution
import hashlib
import json
import shutil
import sys

root = Path(__file__).resolve().parents[1]
output = root/'app/build/jianying'
output.mkdir(parents=True, exist_ok=True)
binary = root/'.generated/native-engine/JianYingEngine.exe'
shutil.copy2(binary, output/binary.name)
(output/'engine.json').write_text(json.dumps({'sha256': hashlib.sha256(binary.read_bytes()).hexdigest()}, indent=2), encoding='utf-8')
packages = ['PyInstaller', 'pyautogui', 'pynput', 'Pillow', 'opencv-python-headless', 'numpy', 'requests', 'charset-normalizer', 'idna', 'urllib3', 'certifi', 'six', 'pymsgbox', 'pyscreeze', 'pytweening', 'mouseinfo', 'pyperclip', 'cryptography', 'cffi', 'pycparser']
inventory = []
for package in packages:
    dist = distribution(package)
    licenses = []
    for item in dist.files or []:
        if not any(word in item.name.lower() for word in ['license', 'copying', 'notice']): continue
        source = Path(dist.locate_file(item))
        if not source.is_file() or source.suffix.lower() in {'.py', '.pyc', '.dll', '.pyd'}: continue
        target = output/'licenses'/package/Path(*item.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        licenses.append(str(target.relative_to(output)))
    if not licenses:
        target = output/'licenses'/package/'METADATA.txt'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(dist.read_text('METADATA') or dist.read_text('PKG-INFO') or '', encoding='utf-8')
    inventory.append({'name': package, 'version': dist.version, 'licenseFiles': licenses})
license_file = Path(sys.base_prefix)/'LICENSE.txt'
if license_file.exists(): shutil.copy2(license_file, output/'Python-LICENSE.txt')
shutil.copy2(root/'docs/native-runtime-notices.txt', output/'THIRD_PARTY_NOTICES.txt')
(output/'runtime-components.json').write_text(json.dumps(inventory, indent=2), encoding='utf-8')
print('Native engine and dependency notices staged.')
