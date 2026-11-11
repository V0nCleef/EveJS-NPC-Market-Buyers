"""Portable release-sidecar checks; no Launcher or game installation needed."""
import json
import hashlib
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
        cls.scratch = ROOT / '.test-runtime'
        cls.scratch.mkdir(exist_ok=True)
        cls.temporary = tempfile.TemporaryDirectory(prefix='npc-market-update-package-', dir=cls.scratch)
        cls.directory = Path(cls.temporary.name).resolve()
        assert cls.directory.is_relative_to(cls.scratch.resolve())
        subprocess.run([sys.executable, '-B', str(ROOT / 'pack-release.py'),
                        '--output-dir', str(cls.directory)], check=True, capture_output=True)
        cls.version = json.loads((ROOT / 'package.json').read_text())['version']
        cls.archive = cls.directory / ('NPC-Market-Buyers-' + cls.version + '.zip')

    @classmethod
    def tearDownClass(cls):
        assert cls.directory.is_relative_to(cls.scratch.resolve())
        cls.temporary.cleanup()

    def test_finished_assets_bind_identity_version_and_compatibility(self):
        with zipfile.ZipFile(self.archive) as bundle:
            manifest = json.loads(bundle.read('npc-market-buyers/evejs-launcher.mod.json'))
        metadata = json.loads(self.archive.with_suffix('.update.json').read_text())
        expected = dict(schemaVersion=1, id=manifest['id'],
            version=manifest['version'], asset=manifest['updates']['asset'].replace('{version}', self.version))
        versions = manifest.get('compatibility', {}).get('evejsVersions')
        if versions:
            expected['evejsVersions'] = versions
        self.assertEqual(metadata, expected)

    def test_rebuild_contains_exact_frozen_release_members(self):
        receipt = json.loads((ROOT / 'releases' / (self.version + '.json')).read_text())
        expected = receipt['sourceMemberMapping']
        with zipfile.ZipFile(self.archive) as bundle:
            members = {name.split('/', 1)[1]: bundle.read(name) for name in bundle.namelist()}
        self.assertEqual(set(members), set(expected))
        for name, content in members.items():
            self.assertEqual(hashlib.sha256(content).hexdigest(), expected[name]['sha256'], name)
        self.assertEqual(hashlib.sha256(self.archive.with_suffix('.update.json').read_bytes()).hexdigest(),
                         receipt['updateMetadataSHA256'])

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

    def test_generator_preserves_actual_declared_versions_without_a_docker_fallback(self):
        directory = self.directory / 'declared-version-control'
        directory.mkdir()
        archive = directory / self.archive.name
        manifest = dict(schemaVersion=3, id='npc-market-buyers', version=self.version,
                        updates=dict(provider='github', asset='NPC-Market-Buyers-{version}.zip'),
                        compatibility=dict(evejsVersions=['261028.1', '261108.1']))
        with zipfile.ZipFile(archive, 'w') as bundle:
            bundle.writestr('control/evejs-launcher.mod.json', json.dumps(manifest))
        metadata = json.loads(build(archive).read_text())
        self.assertEqual(metadata['evejsVersions'], ['261028.1', '261108.1'])


if __name__ == '__main__':
    unittest.main()
