"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execute, ALLOWED } = require("../lib/install");
const { spawn } = require("node:child_process");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const linux = { skip: process.platform !== "linux" };
process.env.EVEJS_LAUNCHER_HELPER_FEATURES = "native-linux-market-runtime-v1";
function fixture(t) {
  const base = path.resolve(__dirname, "../.test-runtime"); fs.mkdirSync(base, { recursive: true });
  const temp = fs.mkdtempSync(path.join(base, "native-linux-"));
  t.after(() => { assert.ok(temp.startsWith(base + path.sep)); fs.rmSync(temp, { recursive: true, force: true }); });
  const root = path.join(temp, "world"), mod = path.join(temp, "package");
  const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
  const targets = [ALLOWED[0].replace(/\.exe$/, ""), ...ALLOWED.slice(1)];
  const binary = Buffer.alloc(64); binary.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]); binary.writeUInt16LE(62, 18);
  write(path.join(root, "package.json"), '{"version":"261115.2"}');
  write(path.join(root, "server/package.json"), "{}");
  for (const name of ["i18n.py", "sell_advisor.py", "hud.py", "companion.py", "wallet_summary.py"]) write(path.join(mod, "client", name), "# fixture\n");
  const files = targets.map((target, i) => {
    const payload = i === 0 ? "native/linux-x64/0.bin" : `native/${i}.bin`;
    write(path.join(mod, "payload", payload), i === 0 ? binary : "patched-" + i);
    write(path.join(root, target), i === 0 ? Buffer.concat([binary, Buffer.from("original")]) : "original-" + i);
    fs.chmodSync(path.join(root, target), i === 0 ? 0o750 : 0o640);
    return { target, payload };
  });
  // The Windows payload remains in the same universal package; Linux must select ELF.
  write(path.join(mod, "payload/native/0.bin"), "MZ-WINDOWS");
  write(path.join(mod, "payload/native.json"), JSON.stringify({ schema: 2, files: ALLOWED.map((target, i) => ({ target, payload: `native/${i}.bin` })) }));
  write(path.join(root, ALLOWED[0]), "PRESERVE OTHER HOST FILE");
  const market = path.join(root, "externalservices/market-server"), compilerInputs = {};
  for (const [name, bytes] of [["Cargo.toml", "fixture Cargo"], ["Cargo.lock", "fixture lock"]]) {
    write(path.join(market, name), bytes); compilerInputs[name] = sha(bytes);
  }
  for (const [i, file] of files.entries()) if (i > 0) compilerInputs[path.relative(market, path.join(root, file.target)).replaceAll(path.sep, "/")] = sha("patched-" + i);
  const metadata = { schema: 1, files, runtime: { schema: "npc-market-buyers-linux-x64/1", architecture: "x64",
    evejsVersions: ["261115.2"], binarySHA256: sha(binary), compilerInputs } };
  write(path.join(mod, "payload/native-linux-x64.json"), JSON.stringify(metadata));
  const request = action => ({ protocol: "evejs-launcher-mod-helper-v1", requestId: "fixture", action,
    runtime: { backend: "native", evejsRoot: root } });
  const run = action => execute(request(action), { modRoot: mod, inactive: async () => {} });
  return { root, mod, targets, files, binary, metadata, run, request,
    receipt: path.join(root, "_local/npc-market-buyers/install/receipt.json"),
    pending: path.join(root, "_local/npc-market-buyers/install/pending.json") };
}
test("native Linux installation selects ELF and binds the exact runtime; disable restores bytes and modes", linux, async t => {
  const f = fixture(t), originals = f.targets.map(n => fs.readFileSync(path.join(f.root, n)));
  await f.run("install"); await f.run("verify");
  assert.deepEqual(fs.readFileSync(path.join(f.root, f.targets[0])), f.binary);
  assert.equal(fs.statSync(path.join(f.root, f.targets[0])).mode & 0o777, 0o755);
  assert.equal(fs.readFileSync(path.join(f.root, ALLOWED[0]), "utf8"), "PRESERVE OTHER HOST FILE");
  const receipt = JSON.parse(fs.readFileSync(f.receipt));
  assert.equal(receipt.nativeHost, "linux-x64"); assert.equal(receipt.linuxRuntime.binarySHA256, sha(f.binary));
  assert.match(receipt.linuxRuntime.sourceDigest, /^[A-F0-9]{64}$/);
  const before = fs.readFileSync(f.receipt); await f.run("prepare_profile"); await f.run("prepare_server_start");
  assert.deepEqual(fs.readFileSync(f.receipt), before);
  await f.run("prepare_disable");
  f.targets.forEach((name, i) => assert.deepEqual(fs.readFileSync(path.join(f.root, name)), originals[i]));
  assert.equal(fs.statSync(path.join(f.root, f.targets[0])).mode & 0o777, 0o750);
});
test("Linux rejects a Windows binary or mismatched compiled source before any installation mutation", linux, async t => {
  const f = fixture(t), binary = path.join(f.mod, "payload/native/linux-x64/0.bin");
  fs.writeFileSync(binary, "MZ-NOT-LINUX");
  await assert.rejects(f.run("install"), /ELF|Linux.*binary|checksum/);
  assert.equal(fs.existsSync(f.receipt), false);
  fs.writeFileSync(binary, f.binary);
  fs.writeFileSync(path.join(f.root, "externalservices/market-server/Cargo.lock"), "UNREVIEWED DEPENDENCIES");
  await assert.rejects(f.run("install"), /compiled.*source|build input/i);
  assert.equal(fs.existsSync(f.receipt), false);
});
test("Linux interrupted installation recovers with executable permissions and retains unrelated state", linux, async t => {
  const f = fixture(t), rename = fs.renameSync; let count = 0;
  fs.renameSync = (from, to) => { if (to.startsWith(path.join(f.root, "externalservices")) && ++count === 3) throw Error("Interrupted fixture"); return rename(from, to); };
  try { await assert.rejects(f.run("install"), /Interrupted fixture/); } finally { fs.renameSync = rename; }
  assert.equal(fs.existsSync(f.pending), true);
  await f.run("recover"); await f.run("verify");
  assert.equal(fs.existsSync(f.pending), false);
  assert.equal(fs.statSync(path.join(f.root, f.targets[0])).mode & 0o777, 0o755);
});
test("Linux updater repair retains the original executable permissions", linux, async t => {
  const f = fixture(t), identities = require("../lib/nativeIdentities.json");
  const originals = f.targets.map(name => fs.readFileSync(path.join(f.root, name)));
  const baseline = { id: "linux-permissions-fixture", sha256: [null, ...originals.slice(1).map(sha)] };
  identities.baselines.push(baseline); t.after(() => identities.baselines.splice(identities.baselines.indexOf(baseline), 1));
  await f.run("install");
  f.targets.slice(1).forEach((name, index) => fs.writeFileSync(path.join(f.root, name), originals[index + 1]));
  await f.run("prepare_server_start"); await f.run("prepare_disable");
  assert.deepEqual(fs.readFileSync(path.join(f.root, f.targets[0])), originals[0]);
  assert.equal(fs.statSync(path.join(f.root, f.targets[0])).mode & 0o777, 0o750);
});
test("an older Linux launcher is refused before any native installation changes", linux, async t => {
  const f = fixture(t), features = process.env.EVEJS_LAUNCHER_HELPER_FEATURES;
  delete process.env.EVEJS_LAUNCHER_HELPER_FEATURES;
  try {
    await assert.rejects(f.run("install"), /Launcher 1.0.87/);
    assert.equal(fs.existsSync(f.receipt), false);
  } finally { process.env.EVEJS_LAUNCHER_HELPER_FEATURES = features; }
});
test("the Linux guard catches a selected Node server before it binds a listener", linux, async t => {
  const f = fixture(t), script = path.join(f.root, "server/index.js");
  fs.writeFileSync(script, "console.log('ready');setInterval(()=>{},1000)");
  const child = spawn(process.execPath, [script], { cwd: path.dirname(script), stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  await new Promise((resolve, reject) => { child.once("error", reject); child.stdout.once("data", resolve); });
  assert.throws(() => require("../lib/linuxNative").assertInactive(f.root), /Stop this EveJS server/);
  assert.equal(child.exitCode, null);
});
for (const terminal of ["commit_update", "rollback_update"]) test("Linux enabled update preserves pending settlement through " + terminal, linux, async t => {
  const f = fixture(t), old = path.join(f.root, "mods/previous-npc");
  fs.mkdirSync(path.dirname(old), { recursive: true }); fs.cpSync(f.mod, old, { recursive: true });
  const declared = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../evejs-launcher.mod.json")));
  const { FINANCIAL, PROTOCOL } = require("../lib/activeUpdate");
  const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  for (const [folder, version] of [[old, "0.1.25"], [f.mod, declared.version]]) {
    write(path.join(folder, "evejs-launcher.mod.json"), JSON.stringify({ ...declared, version }));
    write(path.join(folder, "package.json"), JSON.stringify({ version }));
    write(path.join(folder, "loader.js"), "// enabled authored predecessor fixture");
    for (const name of FINANCIAL) write(path.join(folder, "lib", name), fs.readFileSync(path.resolve(__dirname, "../lib", name)));
  }
  await execute(f.request("install"), { modRoot: old, inactive: async () => {} });
  const oldReceipt = JSON.parse(fs.readFileSync(f.receipt)); oldReceipt.version = "0.1.25";
  fs.writeFileSync(f.receipt, JSON.stringify(oldReceipt));
  const oldBytes = fs.readFileSync(path.join(f.root, f.targets[0]));
  const incoming = Buffer.concat([f.binary, Buffer.from("incoming authored ELF fixture")]);
  write(path.join(f.mod, "payload/native/linux-x64/0.bin"), incoming);
  f.metadata.runtime.binarySHA256 = sha(incoming);
  write(path.join(f.mod, "payload/native-linux-x64.json"), JSON.stringify(f.metadata));
  const Database = require(path.join(process.env.EVEJS_TEST_ROOT, "server/node_modules/better-sqlite3"));
  write(path.join(f.root, "server/node_modules/better-sqlite3/index.js"), "module.exports=require(" + JSON.stringify(path.join(process.env.EVEJS_TEST_ROOT, "server/node_modules/better-sqlite3")) + ");");
  const store = require("../lib/store").createStore(path.join(f.root, "_local/npc-market-buyers/state.sqlite"), { Database });
  try {
    require("../lib/settlement").createNativeBridge({}).attach(store);
    require("../lib/engine").createEngine({ store, adapter: {}, getConfig: () => store.getConfig() });
    store.db.prepare("INSERT INTO nm_operations(operation_key,cycle_id,group_key,day,seller_id,type_id,quantity,cost_cents,state,order_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("npc-market:synthetic:linux-pending", "cycle", "fixture", "2026-01-01", 2, 34, 10, 10000, "pending", "{}", 1, 1);
    const rows = () => JSON.stringify(store.db.prepare("SELECT * FROM nm_operations").all());
    const before = rows(), transactionId = crypto.randomUUID();
    const run = action => execute({ ...f.request(action), update: { protocol: PROTOCOL, transactionId,
      fromVersion: "0.1.25", fromModRoot: old, toVersion: declared.version } }, { modRoot: f.mod, inactive: async () => {} });
    await run("prepare_update"); await run("apply_update"); await run(terminal); await run(terminal);
    assert.equal(rows(), before);
    assert.deepEqual(fs.readFileSync(path.join(f.root, f.targets[0])), terminal === "commit_update" ? incoming : oldBytes);
    assert.equal(fs.statSync(path.join(f.root, f.targets[0])).mode & 0o777, 0o755);
    await assert.rejects(f.run("prepare_disable"), /settlement needs recovery/);
  } finally { store.close(); }
});
module.exports = { fixture };
