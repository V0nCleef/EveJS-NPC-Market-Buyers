"""Portable release-sidecar checks; no Launcher or game installation needed."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.build_update_metadata import build


class UpdatePackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='npc-market-update-package-')
        cls.directory = Path(cls.temporary.name).resolve()
        assert cls.directory.is_relative_to(Path(tempfile.gettempdir()).resolve())
        subprocess.run([sys.executable, '-B', str(ROOT / 'pack-release.py'),
                        '--output-dir', str(cls.directory)], check=True, capture_output=True)
        cls.version = json.loads((ROOT / 'package.json').read_text())['version']
        cls.archive = cls.directory / ('NPC-Market-Buyers-' + cls.version + '.zip')

    @classmethod
    def tearDownClass(cls):
        assert cls.directory.is_relative_to(Path(tempfile.gettempdir()).resolve())
        cls.temporary.cleanup()

    def test_finished_assets_bind_identity_version_and_compatibility(self):
        with zipfile.ZipFile(self.archive) as bundle:
            manifest = json.loads(bundle.read('NPC-Market-Buyers-' + self.version + '/evejs-launcher.mod.json'))
        metadata = json.loads(self.archive.with_suffix('.update.json').read_text())
        self.assertEqual(metadata, dict(schemaVersion=1, id=manifest['id'],
            version=manifest['version'], asset=manifest['updates']['asset'].replace('{version}', self.version),
            evejsVersions=manifest['compatibility']['evejsVersions']))

    def test_standalone_generator_does_not_overwrite_existing_sidecar(self):
        target = self.archive.with_suffix('.update.json')
        before = target.read_bytes()
        with self.assertRaises(FileExistsError):
            build(self.archive)
        self.assertEqual(target.read_bytes(), before)

    def test_wrong_zip_name_cannot_emit_update_metadata(self):
        archive = self.directory / 'WrongName.zip'
        archive.write_bytes(self.archive.read_bytes())
        with self.assertRaises(ValueError):
            build(archive)
        self.assertFalse(archive.with_suffix('.update.json').exists())

    def test_legacy_package_cannot_claim_update_support(self):
        archive = self.directory / 'Legacy.zip'
        with zipfile.ZipFile(archive, 'w') as bundle:
            bundle.writestr('Legacy/evejs-launcher.mod.json', json.dumps(dict(
                schemaVersion=3, id='npc-market-buyers', version=self.version)))
        with self.assertRaises(ValueError):
            build(archive)
        self.assertFalse(archive.with_suffix('.update.json').exists())


if __name__ == '__main__':
    unittest.main()
