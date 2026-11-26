"""Build the universal package's native Linux payload and compiler-input receipt."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import platform
import shlex
import shutil
import struct
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-dir", type=Path, required=True)
    parser.add_argument("--evejs-version", action="append", required=True)
    parser.add_argument("--target-2611253", action="store_true")
    args = parser.parse_args()
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64"):
        raise RuntimeError("Build this payload on native x86_64 Linux")
    if args.target_2611253 and args.evejs_version != ['261125.3', '261126.2']:
        raise ValueError('Shared payload must bind exactly the reviewed 261125.3 and 261126.2 compiler inputs')
    if not args.target_2611253 and args.evejs_version != ['261115.2']:
        raise ValueError('Legacy payload must retain its reviewed 261115.2 binding')
    source = ROOT / ('native/market-server-2611253' if args.target_2611253 else 'native/market-server')
    manifest = json.loads((ROOT / "payload/native.json").read_text())
    for entry in manifest["files"][1:]:
        relative = Path(entry["target"]).relative_to("externalservices/market-server")
        if sha(source / relative) != sha(ROOT / "payload" / entry["payload"]):
            raise ValueError("Linux source differs from the packaged native overlay")
    inputs_before = {p.relative_to(source).as_posix(): sha(p) for p in source.rglob("*")
                     if p.is_file() and "target" not in p.relative_to(source).parts}
    environment = dict(os.environ)
    for key in ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER", "RUSTDOCFLAGS"):
        environment.pop(key, None)
    target = args.target_dir.resolve()
    # Keep build-machine and private cache paths out of the shipped executable.
    remaps = {ROOT: '/build/npc-market-buyers', target: '/build/target',
              Path(environment.get('CARGO_HOME', Path.home() / '.cargo')).resolve(): '/build/cargo'}
    environment['CARGO_ENCODED_RUSTFLAGS'] = '\x1f'.join(
        f'--remap-path-prefix={source_path}={destination}' for source_path, destination in remaps.items())
    subprocess.run(["cargo", "build", "--locked", "--release", "--bin", "market-server", "--target-dir", str(target)],
                   cwd=source, env=environment, check=True, timeout=3600)
    for name, digest in inputs_before.items():
        if sha(source / name) != digest:
            raise ValueError("Native sources changed during compilation")
    # Cargo emits Make-style escaping for spaces, backslashes and dollar signs.
    line = (target / "release/market-server.d").read_text().replace("\\\n", "").splitlines()[0]
    escaped = False
    separator = None
    for index, char in enumerate(line):
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == ":":
            separator = index
            break
    if separator is None:
        raise ValueError("Cargo compiler dependency record is malformed")
    names = {"Cargo.toml", "Cargo.lock"}
    external = [target, Path(environment.get("CARGO_HOME", Path.home() / ".cargo")).resolve(),
                Path(environment.get("RUSTUP_HOME", Path.home() / ".rustup")).resolve()]
    for name in shlex.split(line[separator + 1:]):
        path = Path(name.replace("$$", "$"))
        path = (path if path.is_absolute() else source / path).resolve(strict=True)
        if path.is_relative_to(source):
            names.add(path.relative_to(source).as_posix())
        elif not any(path.is_relative_to(parent) for parent in external):
            raise ValueError("Native build read a compiler input outside the selected source tree")
    binary = target / "release/market-server"
    with binary.open("rb") as stream:
        header = stream.read(64)
    if len(header) < 64 or header[:6] != b"\x7fELF\x02\x01" or struct.unpack_from("<H", header, 18)[0] != 62:
        raise ValueError("Native build did not produce an x86_64 ELF executable")
    payload = 'native/linux-x64-2611253/0.bin' if args.target_2611253 else 'native/linux-x64/0.bin'
    destination = ROOT / 'payload' / payload
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(binary, destination)
    files = [{"target": manifest["files"][0]["target"].removesuffix(".exe"), "payload": payload},
             *manifest["files"][1:]]
    metadata = {"schema": 1, "files": files, "runtime": {
        "schema": "npc-market-buyers-linux-x64/1", "architecture": "x64",
        "evejsVersions": args.evejs_version, "binarySHA256": sha(destination),
        "compilerInputs": {name: sha(source / name) for name in sorted(names)},
        "rustc": subprocess.check_output(["rustc", "--version"], text=True).strip(),
        "cargoLocked": True}}
    name='native-linux-x64-2611253.json' if args.target_2611253 else 'native-linux-x64.json'
    (ROOT / 'payload' / name).write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps({"binarySHA256": metadata["runtime"]["binarySHA256"], "compilerInputs": len(names)}))


if __name__ == "__main__":
    main()
