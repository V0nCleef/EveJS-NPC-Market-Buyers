"""Package only authored mod files and corresponding open native source."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent
version = json.loads((root / 'package.json').read_text())['version']
prefix = 'NPC-Market-Buyers-' + version
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-dir', type=Path, default=root / 'dist',
                    help='Destination directory; use a separate directory for rebuild checks.')
output = parser.parse_args().output_dir.resolve()
output.mkdir(parents=True, exist_ok=True)
archive = output / (prefix + '.zip')
files = [root / name for name in (
    'loader.js.disabled', 'helper.js', 'evejs-launcher.mod.json',
    'README.md', 'VERIFICATION.md', 'build-payload.cjs', 'build-locales.py')]
for folder in ('lib', 'client', 'payload', 'native/market-server/src',
               'native/market-server/crates'):
    files.extend(p for p in (root / folder).rglob('*') if p.is_file())
files.extend(root / ('native/market-server/' + name) for name in (
    'Cargo.toml', 'Cargo.lock', 'config/market-server.example.toml'))
package = json.loads((root / 'package.json').read_text())
package.pop('scripts', None)
license_bytes = (root / 'LICENSE').read_bytes()
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as target:
    for file in sorted(files):
        if file.suffix == '.pyc' or '__pycache__' in file.parts:
            continue
        target.write(file, prefix + '/' + file.relative_to(root).as_posix())
    target.writestr(prefix + '/package.json', json.dumps(package, indent=2) + '\n')
    target.writestr(prefix + '/LICENSE', license_bytes)
with zipfile.ZipFile(archive) as check:
    assert check.testzip() is None
    assert not any('/evidence/' in name or '/target/' in name or '/.tools/' in name for name in check.namelist())
receipt = {'archive': str(archive), 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
           'bytes': archive.stat().st_size, 'entries': len(check.namelist())}
(output / 'package.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
