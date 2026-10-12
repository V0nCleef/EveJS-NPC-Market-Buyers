"""Actual Launcher updater integration, using only disposable stopped roots."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
OLD_VERSION = VERSION + '-updater-fixture.1'
ARCHIVE = ROOT / 'dist' / ('NPC-Market-Buyers-' + VERSION + '.zip')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--hosted', action='store_true')
ARGS, remaining = parser.parse_known_args()
BASELINE = Path(os.environ['EVEJS_TEST_ROOT']).resolve(strict=True)
LAUNCHER = Path(os.environ['EVEJS_LAUNCHER_ROOT']).resolve(strict=True)
TEST_ROOT = ROOT / '.test-runtime'
TEST_ROOT.mkdir(exist_ok=True)
ANCHOR = Path(tempfile.mkdtemp(prefix='launcher-updates-', dir=TEST_ROOT)).resolve()
assert ANCHOR.is_relative_to(TEST_ROOT.resolve()) and not BASELINE.is_relative_to(ANCHOR)
# Import the real Launcher with its global configuration paths confined too.
os.environ['APPDATA'] = str(ANCHOR / 'appdata')
os.environ['LOCALAPPDATA'] = str(ANCHOR / 'localappdata')
sys.dont_write_bytecode = True
sys.path.insert(0, str(LAUNCHER))
from src.core.local_mod_packages import LocalModPackages
from src.core.mod_manifest import scan_mods
from src.core.mod_operations import ModOperationContext, change_mod_state, remove_local_mod, run_public_action
from src.core.mod_update_source import check_update, download_release, ModUpdateError, parse_update_source
from src.core.mod_updates import install_release, pending_updates

MANIFEST = json.loads((ROOT / 'evejs-launcher.mod.json').read_text())
SOURCE = parse_update_source(MANIFEST['updates'])
PAYLOAD = json.loads((ROOT / 'payload/native.json').read_text())['files']
RECORDS = []
NATIVE_ORIGINALS = {}


def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def current(root):
    matches = [mod for mod in scan_mods(root) if mod.id == 'npc-market-buyers']
    assert len(matches) == 1 and matches[0].valid
    return matches[0]


def fixture():
    root = Path(tempfile.mkdtemp(prefix='evejs-', dir=ANCHOR)).resolve()
    assert root.is_relative_to(ANCHOR) and root != BASELINE
    originals = {}
    for entry in PAYLOAD:
        original = BASELINE / entry['target']
        originals[entry['target']] = original.read_bytes() if original.exists() else None
        if not original.exists():
            continue
        target = root / entry['target']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
    NATIVE_ORIGINALS[root] = originals
    for relative in ('package.json', 'server/package.json', 'server/src/network/tcp/handshake.js'):
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(BASELINE / relative, target)
    for package in ('better-sqlite3', 'bindings', 'file-uri-to-path'):
        shutil.copytree(BASELINE / 'server/node_modules' / package, root / 'server/node_modules' / package)
    ports = []
    for _ in range(3):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            ports.append(probe.getsockname()[1])
    (root / 'config').mkdir()
    (root / 'config/server.json').write_text(json.dumps({'network': {'serverPort': ports[0]}}))
    config = root / 'externalservices/market-server/config/market-server.local.toml'
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text('[network]\nport = %d\n[rpc]\nenabled = true\nport = %d\n' % tuple(ports[1:]))
    database = root / '_local/npc-market-buyers/state.sqlite'
    database.parent.mkdir(parents=True, exist_ok=True)
    # Real saved policy/activity schema, with clearly synthetic history.
    seed = """const {createStore}=require(process.argv[1]);
const s=createStore(process.argv[2],{root:process.argv[3]});
s.saveConfig({...s.getConfig(),offlinePurchases:true},s.getRevision());
s.recordActivity({kind:'test-fixture',message:'Synthetic updater preservation receipt',characterID:42});
s.close();"""
    subprocess.run(['node', '-e', seed, str(ROOT / 'lib/store.js'), str(database), str(root)], check=True)
    sentinel = root / '_local/unrelated-save.txt'
    sentinel.write_text('Unrelated saved data must survive.\n')
    operation = ModOperationContext(root, backend='native', profiles_root=ANCHOR / 'profiles',
                                    local_appdata=ANCHOR / 'localappdata')
    return root, operation, {database: sha(database), sentinel: sha(sentinel)}


def assert_preserved(root, saved):
    assert all(sha(file) == digest for file, digest in saved.items())
    with sqlite3.connect(root / '_local/npc-market-buyers/state.sqlite') as db:
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert db.execute('SELECT COUNT(*) FROM nm_activity').fetchone()[0] == 1
        assert json.loads(db.execute("SELECT value FROM nm_meta WHERE key='config'").fetchone()[0])['offlinePurchases']
    assert not pending_updates(root)


def older_package():
    path = ANCHOR / 'synthetic-older-package.zip'
    with zipfile.ZipFile(ARCHIVE) as original, zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as output:
        for entry in original.infolist():
            data = original.read(entry)
            if entry.filename.endswith(('/package.json', '/evejs-launcher.mod.json')):
                value = json.loads(data)
                value['version'] = OLD_VERSION
                data = (json.dumps(value, indent=2) + '\n').encode()
            output.writestr(entry.filename, data)
    return path


def fake_feed(metadata=None, *, missing=False):
    raw = (ARCHIVE.with_suffix('.update.json').read_bytes() if metadata is None
           else json.dumps(metadata).encode())
    prefix = 'https://github.com/' + SOURCE.repository + '/releases/'
    zip_url = prefix + 'download/v' + VERSION + '/' + ARCHIVE.name
    sidecar_url = zip_url[:-4] + '.update.json'
    assets = [dict(name=ARCHIVE.name, state='uploaded', size=ARCHIVE.stat().st_size,
                   digest='sha256:' + sha(ARCHIVE), browser_download_url=zip_url)]
    if not missing:
        assets.append(dict(name=ARCHIVE.with_suffix('.update.json').name, state='uploaded',
                           size=len(raw), digest='sha256:' + hashlib.sha256(raw).hexdigest(),
                           browser_download_url=sidecar_url))
    release = dict(tag_name='v' + VERSION, draft=False, prerelease=False, assets=assets,
                   html_url=prefix + 'tag/v' + VERSION, body='Updater fixture')
    responses = {'https://api.github.com/repos/' + SOURCE.repository + '/releases?per_page=100':
                 json.dumps([release]).encode(), sidecar_url: raw, zip_url: ARCHIVE.read_bytes()}
    return lambda url: io.BytesIO(responses[url])


def guard_for(root):
    def guard():
        assert root.is_relative_to(ANCHOR) and root != BASELINE
        script = "require(process.argv[1]).assertInactive(process.argv[2]).catch(e=>{console.error(e.message);process.exitCode=1});"
        subprocess.run(['node', '-e', script, str(ROOT / 'lib/install.js'), str(root)], check=True)
    return guard


class LauncherUpdateTests(unittest.TestCase):
    def test_compatible_feed_current_version_and_rejected_metadata(self):
        self.assertIsNotNone(check_update(SOURCE, OLD_VERSION, evejs_version='0.12.9',
            expected_mod_id='npc-market-buyers', opener=fake_feed()))
        self.assertIsNone(check_update(SOURCE, VERSION, evejs_version='0.12.9', opener=fake_feed()))
        self.assertIsNotNone(check_update(SOURCE, OLD_VERSION, evejs_version='0.12.8', opener=fake_feed()))
        self.assertIsNone(check_update(SOURCE, OLD_VERSION, evejs_version='0.12.9', opener=fake_feed(missing=True)))
        metadata = json.loads(ARCHIVE.with_suffix('.update.json').read_text())
        metadata['id'] = 'different-mod'
        self.assertIsNone(check_update(SOURCE, OLD_VERSION, evejs_version='0.12.9',
            expected_mod_id='npc-market-buyers', opener=fake_feed(metadata)))

    def replacement(self, enabled, fail=False):
        root, operation, saved = fixture()
        LocalModPackages(root).import_package(older_package(), enabled=False)
        if enabled:
            change_mod_state(current(root), True, operation)
        release = check_update(SOURCE, OLD_VERSION, evejs_version='0.12.9',
            expected_mod_id='npc-market-buyers', opener=fake_feed())
        def download(candidate, target):
            return download_release(candidate, target, opener=fake_feed())
        def activate(mod, desired, context):
            if fail and desired and mod.version == VERSION:
                raise RuntimeError('Deliberately failed candidate activation')
            return change_mod_state(mod, desired, context)
        with patch('src.core.mod_updates.change_mod_state', side_effect=activate):
            if fail:
                with self.assertRaisesRegex(ModUpdateError, 'previous mod version and enabled state were restored'):
                    install_release(current(root), release, operation, guard=guard_for(root), downloader=download)
            else:
                install_release(current(root), release, operation, guard=guard_for(root), downloader=download)
        mod = current(root)
        self.assertEqual(mod.version, OLD_VERSION if fail else VERSION)
        self.assertEqual(mod.active, enabled)
        self.assertEqual(mod.api_descriptor.updates, SOURCE)
        for entry in PAYLOAD:
            expected = ((ROOT / 'payload' / entry['payload']).read_bytes() if enabled
                        else NATIVE_ORIGINALS[root][entry['target']])
            file = root / entry['target']
            if expected is None:
                self.assertFalse(file.exists())
            else:
                self.assertEqual(file.read_bytes(), expected)
        if enabled:
            run_public_action(mod, 'verify', operation).require_ready()
        assert_preserved(root, saved)
        RECORDS.append(dict(fixture=str(root), test='rollback' if fail else 'replacement', enabled=enabled,
                            resultVersion=mod.version, savedDatabaseUnchanged=True, unrelatedSaveUnchanged=True))

    def test_enabled_update_and_preservation(self):
        self.replacement(True)

    def test_disabled_update_and_preservation(self):
        self.replacement(False)

    def test_failed_activation_restores_old_enabled_package(self):
        self.replacement(True, fail=True)

    @unittest.skipUnless(os.environ.get('EVEJS_PREVIOUS_PACKAGE'), 'No original legacy ZIP supplied')
    def test_one_time_manual_import_from_original_legacy_package(self):
        root, operation, saved = fixture()
        manager = LocalModPackages(root)
        manager.import_package(Path(os.environ['EVEJS_PREVIOUS_PACKAGE']), enabled=False)
        self.assertIsNone(current(root).api_descriptor.updates)
        change_mod_state(current(root), True, operation)
        old_version = current(root).version
        remove_local_mod(current(root), operation)
        manager.import_package(ARCHIVE, enabled=False)
        change_mod_state(current(root), True, operation)
        run_public_action(current(root), 'verify', operation).require_ready()
        self.assertEqual(current(root).version, VERSION)
        self.assertEqual(current(root).api_descriptor.updates, SOURCE)
        assert_preserved(root, saved)
        RECORDS.append(dict(fixture=str(root), test='legacy-manual-import', oldVersion=old_version,
                            resultVersion=VERSION, savedDatabaseUnchanged=True))

    @unittest.skipUnless(ARGS.hosted, 'Public GitHub check runs after publication')
    def test_actual_public_feed_and_download(self):
        release = check_update(SOURCE, OLD_VERSION, evejs_version='0.12.9', expected_mod_id='npc-market-buyers')
        self.assertIsNotNone(release)
        self.assertEqual(release.version, VERSION)
        self.assertTrue(release.metadata_verified)
        downloaded = ANCHOR / 'hosted-download.zip'
        download_release(release, downloaded)
        self.assertEqual(sha(downloaded), sha(ARCHIVE))
        self.assertIsNone(check_update(SOURCE, VERSION, evejs_version='0.12.9', expected_mod_id='npc-market-buyers'))
        RECORDS.append(dict(test='public-GitHub-feed-and-download', version=release.version,
                            metadataVerified=True, sha256=sha(downloaded), alreadyCurrentOffersNothing=True))


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(LauncherUpdateTests))
    evidence = ROOT / 'evidence'
    evidence.mkdir(exist_ok=True)
    (evidence / ('launcher-update-hosted.json' if ARGS.hosted else 'launcher-update-check.json')).write_text(
        json.dumps(dict(version=VERSION, passed=result.wasSuccessful(), tests=result.testsRun,
                        skipped=len(result.skipped), actualLauncherSource=str(LAUNCHER),
                        baselineReadOnly=str(BASELINE), fixtureAnchor=str(ANCHOR), records=RECORDS), indent=2) + '\n')
    sys.exit(0 if result.wasSuccessful() else 1)
