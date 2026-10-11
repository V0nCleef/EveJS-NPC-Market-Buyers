"""Generate the Launcher release sidecar from the finished installable ZIP."""
import argparse
import json
from pathlib import Path, PurePosixPath
import zipfile


def build(archive_path, *, overwrite=False):
    archive_path = Path(archive_path)
    if archive_path.suffix.lower() != '.zip':
        raise ValueError('Provide the installable ZIP.')
    with zipfile.ZipFile(archive_path) as archive:
        manifests = [entry for entry in archive.infolist()
                     if PurePosixPath(entry.filename).name == 'evejs-launcher.mod.json']
        if len(manifests) != 1 or manifests[0].file_size > 1024 * 1024:
            raise ValueError('The ZIP must contain exactly one bounded mod manifest.')
        manifest = json.loads(archive.read(manifests[0]))
    updates = manifest.get('updates', {})
    if manifest.get('schemaVersion') != 3 or updates.get('provider') != 'github':
        raise ValueError('The ZIP must declare schema-3 GitHub update support.')
    version = manifest['version']
    if updates.get('asset', '').replace('{version}', version) != archive_path.name:
        raise ValueError('The ZIP filename differs from its declared update asset.')
    metadata = dict(schemaVersion=1, id=manifest['id'], version=version,
                    asset=archive_path.name)
    versions = manifest.get('compatibility', {}).get('evejsVersions')
    if versions is not None:
        metadata['evejsVersions'] = versions
    destination = archive_path.with_suffix('.update.json')
    with destination.open('w' if overwrite else 'x', encoding='utf-8', newline='\n') as output:
        output.write(json.dumps(metadata, indent=2) + '\n')
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    print(build(parser.parse_args().archive))
