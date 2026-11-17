"use strict";
// Native Linux binaries are packaged with their exact Cargo compiler inputs.
// The lifecycle receipt, outside the mod folder, is also the Launcher's runtime binding.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const validSHA = value => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const MARKET = "externalservices/market-server/";
const SOURCES = ["crates/market-common/src/lib.rs", "src/main.rs", "src/rpc.rs", "src/state.rs"];
const ALLOWED = [MARKET + "target/release/market-server", ...SOURCES.map(name => MARKET + name)];
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
function relative(name) {
  if (typeof name !== "string" || !name || name.includes("\\") || name.startsWith("/") || name.split("/").some(p => !p || p === "." || p === "..") || /[\x00-\x1f\x7f]/.test(name)) throw Error("Invalid Linux compiler input path");
  return name;
}
function compilerInputs(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 10000 ||
      !["Cargo.toml", "Cargo.lock", ...SOURCES].every(name => validSHA(value[name]))) throw Error("Linux compiled source inventory is incomplete");
  for (const [name, digest] of Object.entries(value)) if (!relative(name) || !validSHA(digest)) throw Error("Invalid Linux compiler input inventory");
}
function elf(bytes) {
  if (bytes.length < 64 || !bytes.subarray(0, 6).equals(Buffer.from([127, 69, 76, 70, 2, 1])) || bytes.readUInt16LE(18) !== 62) throw Error("Native Linux Market binary must be an x86_64 ELF executable");
}
function sourceDigest(root, contained, overrides = new Map()) {
  const market = path.join(root, MARKET), names = [];
  for (const name of ["Cargo.toml", "Cargo.lock", "build.rs"]) if (fs.existsSync(path.join(market, name))) names.push(name);
  function visit(directory) {
    if (!fs.existsSync(path.join(market, directory))) return;
    for (const entry of fs.readdirSync(path.join(market, directory), { withFileTypes: true })) {
      const name = directory + "/" + entry.name;
      if (entry.isSymbolicLink()) throw Error("Linux Market sources may not follow a symlink");
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile() && (entry.name.endsWith(".rs") || ["Cargo.toml", "build.rs"].includes(entry.name))) names.push(name);
    }
  }
  visit("src"); visit("crates");
  if (!names.length) throw Error("Linux Market build inputs are missing");
  return sha(names.sort().map(name => name + " " + (overrides.get(name) || sha(fs.readFileSync(contained(root, MARKET + name)))).toUpperCase()).join("\n")).toUpperCase();
}
function load(root, modRoot, manifest, contained, read) {
  if (!String(process.env.EVEJS_LAUNCHER_HELPER_FEATURES || "").split(",").includes("native-linux-market-runtime-v1")) throw Error("Native Linux NPC Market Buyers requires Launcher 1.0.87 or newer");
  if (process.arch !== "x64") throw Error("Native Linux NPC Market Buyers currently requires x86_64");
  const info = manifest.runtime;
  if (manifest.schema !== 1 || info?.schema !== "npc-market-buyers-linux-x64/1" || info.architecture !== "x64" || !validSHA(info.binarySHA256)) throw Error("Native Linux payload metadata is missing or invalid");
  compilerInputs(info.compilerInputs);
  const version = read(contained(root, "package.json"))?.version;
  if (!Array.isArray(info.evejsVersions) || !info.evejsVersions.includes(version)) throw Error("This native Linux Market package does not support the selected EveJS version");
  const payloads = manifest.files.map(file => contained(path.join(modRoot, "payload"), file.payload));
  const hashes = payloads.map(file => sha(fs.readFileSync(file)));
  elf(fs.readFileSync(payloads[0]));
  if (hashes[0] !== info.binarySHA256.toLowerCase()) throw Error("Native Linux Market binary checksum mismatch");
  const overrides = new Map(SOURCES.map((name, i) => [name, hashes[i + 1]]));
  for (const [name, digest] of Object.entries(info.compilerInputs)) {
    const actual = overrides.get(name) || sha(fs.readFileSync(contained(root, MARKET + name)));
    if (actual !== digest.toLowerCase()) throw Error("Linux Market compiled source does not match the selected build input: " + name);
  }
  return { nativeHost: "linux-x64", linuxRuntime: { schema: "evejs-native-linux-market/1", architecture: "x64",
    evejsVersion: version, binary: ALLOWED[0], binarySHA256: hashes[0], sourceDigest: sourceDigest(root, contained, overrides),
    compilerInputs: info.compilerInputs } };
}
function validateReceipt(ctx, receipt) {
  const runtime = receipt.linuxRuntime;
  if (receipt.nativeHost !== "linux-x64" || runtime?.schema !== "evejs-native-linux-market/1" || runtime.architecture !== "x64" ||
      runtime.binary !== ALLOWED[0] || !validSHA(runtime.sourceDigest) || !validSHA(runtime.binarySHA256) ||
      runtime.binarySHA256 !== receipt.files[0].installedSHA || typeof runtime.evejsVersion !== "string") throw Error("Native installation receipt belongs to a different host or Linux runtime");
  compilerInputs(runtime.compilerInputs);
  if (receipt.files.some(file => !Number.isInteger(file.baseMode) || file.baseMode < 0 || file.baseMode > 0o777)) throw Error("Invalid Linux native backup permissions");
}
function bind(ctx, receipt) {
  if (ctx.nativeHost) { receipt.nativeHost = ctx.nativeHost; receipt.linuxRuntime = ctx.linuxRuntime; }
}
function verify(ctx, receipt, contained) {
  validateReceipt(ctx, receipt);
  if (JSON.stringify(canonical(receipt.linuxRuntime)) !== JSON.stringify(canonical(ctx.linuxRuntime))) throw Error("Linux native runtime receipt does not match the current package");
  if (sourceDigest(ctx.root, contained) !== receipt.linuxRuntime.sourceDigest) throw Error("Linux native Market sources changed after installation");
  const binary = contained(ctx.root, ALLOWED[0]), mode = fs.statSync(binary);
  elf(fs.readFileSync(binary));
  if (!(mode.mode & 0o111) || mode.mode & 0o022 || mode.uid !== process.getuid()) throw Error("Linux native Market executable has unsafe ownership or permissions");
}
function assertInactive(root) {
  const market = path.join(root, MARKET), cacheIdentity = sha(root).slice(0, 16);
  const cache = path.join(path.dirname(root), ".evejs-linux-runtime", cacheIdentity);
  for (const item of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(item) || Number(item) === process.pid) continue;
    const proc = "/proc/" + item; let comm;
    try { comm = fs.readFileSync(proc + "/comm", "utf8").trim(); } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) continue; throw Error("Cannot verify stopped native Linux services"); }
    if (!["market-server", "node", "MainThread"].includes(comm)) continue;
    try {
      const cwd = fs.realpathSync(proc + "/cwd"), image = fs.realpathSync(proc + "/exe");
      if ((comm === "market-server" && (cwd === market || image.startsWith(market + path.sep) || image.startsWith(cache + path.sep))) ||
          (["node", "MainThread"].includes(comm) && cwd === path.join(root, "server") && fs.readFileSync(proc + "/cmdline", "utf8").split("\0").some(a => a === "index.js" || a === path.join(root, "server/index.js")))) throw Error("Stop this EveJS server and native market before changing the mod");
    } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) continue; throw error; }
  }
}
module.exports = { ALLOWED, load, validateReceipt, bind, verify, sourceDigest, assertInactive };
