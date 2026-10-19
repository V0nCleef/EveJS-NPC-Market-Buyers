"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {ALLOWED,execute,assertNoPending}=require('../lib/install');
const identities=require('../lib/nativeIdentities.json'),crypto=require('node:crypto');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t){
  const testRoot=path.resolve(__dirname,'../.test-runtime');fs.mkdirSync(testRoot,{recursive:true});
  const temp=fs.mkdtempSync(path.join(testRoot,'npc-install-')),root=path.join(temp,'evejs'),mod=path.join(temp,'mod');
  const write=(file,bytes)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
  write(path.join(root,'server/package.json'),JSON.stringify({version:'newer-user-build'}));
  write(path.join(root,'server/src/network/tcp/handshake.js'),'// Different user build, not a whole-file hash target.\n');
  for(const name of ['i18n.py','sell_advisor.py','hud.py','companion.py','wallet_summary.py'])write(path.join(mod,'client',name),'# fixture\n');
  const files=ALLOWED.map((target,i)=>{
    const original=Buffer.from('original-'+i),replacement=Buffer.from('replacement-'+i),payload=`native/${i}.bin`;
    write(path.join(root,target),original);write(path.join(mod,'payload',payload),replacement);
    return {target,payload};
  });
  write(path.join(mod,'payload/native.json'),JSON.stringify({schema:2,files}));
  t.after(()=>{if(!temp.startsWith(testRoot+path.sep))throw Error('Invalid cleanup target');fs.rmSync(temp,{recursive:true,force:true});});
  const request=action=>({protocol:'evejs-launcher-mod-helper-v1',requestId:'test',action,runtime:{backend:'native',evejsRoot:root}});
  return {root,mod,files,request,run:action=>execute(request(action),{modRoot:mod,inactive:async()=>{}}),
    receipt:path.join(root,'_local/npc-market-buyers/install/receipt.json'),pending:path.join(root,'_local/npc-market-buyers/install/pending.json')};
}
test('native install and disable restore exact bytes; launch preparation is read-only',async t=>{
  const f=fixture(t);await assert.rejects(f.run('verify'),/Enable NPC Market Buyers/);
  await f.run('install');assert.equal(JSON.parse(fs.readFileSync(f.receipt)).state,'active');
  const before=fs.readFileSync(f.receipt);await f.run('prepare_profile');await f.run('verify');assert.deepEqual(fs.readFileSync(f.receipt),before);
  for(const [i,file] of f.files.entries())assert.equal(fs.readFileSync(path.join(f.root,file.target),'utf8'),'replacement-'+i);
  await f.run('prepare_disable');
  for(const [i,file] of f.files.entries())assert.equal(fs.readFileSync(path.join(f.root,file.target),'utf8'),'original-'+i);
  await f.run('install');await f.run('prepare_remove');assert.equal(JSON.parse(fs.readFileSync(f.receipt)).state,'restored');
});
test('active servers remain protected; different native builds are backed up and accepted',async t=>{
  const f=fixture(t);let called=0;
  await assert.rejects(execute(f.request('install'),{modRoot:f.mod,inactive:async()=>{called++;throw Error('Server running');}}),/Server running/);
  assert.equal(called,1);assert.equal(fs.existsSync(f.receipt),false);
  fs.writeFileSync(path.join(f.root,ALLOWED[4]),'newer');await f.run('install');
  await f.run('prepare_disable');assert.equal(fs.readFileSync(path.join(f.root,ALLOWED[4]),'utf8'),'newer');
});
test('interrupted multi-file install recovers deterministically from durable intent',async t=>{
  const f=fixture(t),rename=fs.renameSync;let replacements=0;
  fs.renameSync=(from,to)=>{
    if(to.startsWith(path.join(f.root,'externalservices'))&&++replacements===3)throw Error('Simulated interrupted swap');
    return rename(from,to);
  };
  try{await assert.rejects(f.run('install'),/interrupted swap/);}finally{fs.renameSync=rename;}
  assert.equal(fs.existsSync(f.pending),true);await assert.rejects(f.run('verify'),/needs recovery/);
  await f.run('recover');assert.equal(fs.existsSync(f.pending),false);await f.run('verify');
  await f.run('prepare_disable');assert.equal(fs.readFileSync(path.join(f.root,ALLOWED[0]),'utf8'),'original-0');
});
test('unrecognized changes block mutation; missing backups still prevent destructive restoration',async t=>{
  const f=fixture(t);await f.run('install');fs.writeFileSync(path.join(f.root,ALLOWED[4]),'another-mod');
  for(const action of ['verify','prepare_profile','prepare_server_start','install','recover','prepare_disable','prepare_remove'])await assert.rejects(f.run(action),/unrecognized changes/);
  assert.equal(fs.readFileSync(path.join(f.root,ALLOWED[4]),'utf8'),'another-mod');
  fs.writeFileSync(path.join(f.root,ALLOWED[4]),'replacement-4');
  const receipt=JSON.parse(fs.readFileSync(f.receipt));fs.unlinkSync(path.join(path.dirname(f.receipt),receipt.files[0].backup));
  await assert.rejects(f.run('prepare_disable'),/backup is missing/);
  assert.equal(fs.readFileSync(path.join(f.root,ALLOWED[0]),'utf8'),'replacement-0');
});
test('recover honors interrupted disable intent and never silently reinstalls a restored mod',async t=>{
  const f=fixture(t);await f.run('install');
  const receipt=JSON.parse(fs.readFileSync(f.receipt));
  fs.writeFileSync(f.pending,JSON.stringify({desired:'restored',receipt}));
  await f.run('recover');assert.equal(JSON.parse(fs.readFileSync(f.receipt)).state,'restored');
  await f.run('recover');assert.equal(fs.readFileSync(path.join(f.root,ALLOWED[0]),'utf8'),'original-0');
  await assert.rejects(f.run('verify'),/Enable NPC Market Buyers/);
});
test('fresh ZIP without a compiled daemon installs and restores the original absence',async t=>{
  const f=fixture(t);fs.unlinkSync(path.join(f.root,ALLOWED[0]));
  await f.run('install');await f.run('verify');await f.run('prepare_remove');
  assert.equal(fs.existsSync(path.join(f.root,ALLOWED[0])),false);
  fs.writeFileSync(path.join(f.root,ALLOWED[0]),'later-user-build');
  await f.run('install');await f.run('prepare_disable');
  assert.equal(fs.readFileSync(path.join(f.root,ALLOWED[0]),'utf8'),'later-user-build');
});
test('active repair retains original backups and legacy receipts work without baseline hashes',async t=>{
  const f=fixture(t);await f.run('install');
  const receipt=JSON.parse(fs.readFileSync(f.receipt));receipt.schema=1;receipt.root='old-drive-location';
  for(const [i,file] of receipt.files.entries()){
    fs.copyFileSync(path.join(path.dirname(f.receipt),file.backup),path.join(path.dirname(f.receipt),`backup/${i}.bin`));
    file.backup=`backup/${i}.bin`;delete file.existed;file.baseSHA='obsolete';file.installedSHA='obsolete';
  }
  fs.writeFileSync(f.receipt,JSON.stringify(receipt));await f.run('verify');
  fs.unlinkSync(path.join(f.root,ALLOWED[0]));await f.run('install');
  await f.run('prepare_disable');
  for(const [i,file]of f.files.entries())assert.equal(fs.readFileSync(path.join(f.root,file.target),'utf8'),'original-'+i);
});
function upstream(t,f){
  const bytes=ALLOWED.map((_,i)=>Buffer.from('new-upstream-'+i));
  const item={id:'same-version-updater-fixture',sha256:bytes.map(sha)};
  identities.baselines.push(item);t.after(()=>identities.baselines.splice(identities.baselines.indexOf(item),1));
  return {bytes,replace:()=>{for(let i=1;i<ALLOWED.length;i++)fs.writeFileSync(path.join(f.root,ALLOWED[i]),bytes[i]);}};
}
test('recognized updater replacement requires explicit repair and preserves new uninstall originals',async t=>{
  const f=fixture(t),stock=upstream(t,f);await f.run('install');
  const saved=path.join(f.root,'_local/npc-market-buyers/settings-history-sentinel');fs.writeFileSync(saved,'unchanged policy and history');
  const before=fs.readFileSync(f.receipt);stock.replace();
  for(const action of ['verify','prepare_profile'])await assert.rejects(f.run(action),/Actions > Install \/ Update or Recover/);
  assert.deepEqual(fs.readFileSync(f.receipt),before);
  await f.run('recover');await f.run('verify');await f.run('prepare_disable');
  for(let i=1;i<ALLOWED.length;i++)assert.deepEqual(fs.readFileSync(path.join(f.root,ALLOWED[i])),stock.bytes[i]);
  assert.equal(fs.existsSync(path.join(f.root,ALLOWED[0])),false,'old-version executable must not be restored');
  assert.equal(fs.readFileSync(saved,'utf8'),'unchanged policy and history');
});
test('disable immediately after updater retains new sources without applying mod payload',async t=>{
  const f=fixture(t),stock=upstream(t,f);await f.run('install');stock.replace();await f.run('prepare_remove');
  for(let i=1;i<ALLOWED.length;i++)assert.deepEqual(fs.readFileSync(path.join(f.root,ALLOWED[i])),stock.bytes[i]);
  assert.equal(fs.existsSync(path.join(f.root,ALLOWED[0])),false);
});
test('same-version upstream reinstall retains the original daemon backup',async t=>{
  const f=fixture(t),stock=upstream(t,f);
  for(let i=0;i<ALLOWED.length;i++)fs.writeFileSync(path.join(f.root,ALLOWED[i]),stock.bytes[i]);
  await f.run('install');stock.replace();await f.run('recover');await f.run('prepare_disable');
  for(let i=0;i<ALLOWED.length;i++)assert.deepEqual(fs.readFileSync(path.join(f.root,ALLOWED[i])),stock.bytes[i]);
});
test('partial updater replacement and unknown daemon are preserved and rejected',async t=>{
  const f=fixture(t),stock=upstream(t,f);await f.run('install');
  fs.writeFileSync(path.join(f.root,ALLOWED[1]),stock.bytes[1]);const before=fs.readFileSync(f.receipt);
  for(const action of ['install','recover','prepare_disable'])await assert.rejects(f.run(action),/unrecognized changes/);
  assert.deepEqual(fs.readFileSync(f.receipt),before);assert.equal(fs.existsSync(f.pending),false);
  fs.writeFileSync(path.join(f.root,ALLOWED[1]),'replacement-1');fs.writeFileSync(path.join(f.root,ALLOWED[0]),'unknown rebuilt daemon');
  await assert.rejects(f.run('prepare_disable'),/unrecognized changes/);
  assert.equal(fs.readFileSync(path.join(f.root,ALLOWED[0]),'utf8'),'unknown rebuilt daemon');
});
test('interrupted updater rebase recovers new backup generation and detects backup tampering',async t=>{
  const f=fixture(t),stock=upstream(t,f);await f.run('install');stock.replace();
  const rename=fs.renameSync;let swaps=0;
  fs.renameSync=(from,to)=>{if(to.startsWith(path.join(f.root,'externalservices'))&&++swaps===3)throw Error('Interrupted rebase');return rename(from,to);};
  try{await assert.rejects(f.run('recover'),/Interrupted rebase/);}finally{fs.renameSync=rename;}
  await f.run('recover');await f.run('verify');
  const receipt=JSON.parse(fs.readFileSync(f.receipt));fs.writeFileSync(path.join(path.dirname(f.receipt),receipt.files[2].backup),'changed backup');
  await assert.rejects(f.run('prepare_disable'),/backup identity changed/);
  assert.equal(fs.readFileSync(path.join(f.root,ALLOWED[2]),'utf8'),'replacement-2');
});
test('server-start preparation is a read-only no-op for healthy active support even with a running market',async t=>{
  const f=fixture(t);await f.run('install');
  const receipt=JSON.parse(fs.readFileSync(f.receipt));
  const files=[f.receipt,...ALLOWED.map(target=>path.join(f.root,target)),...receipt.files.filter(file=>file.existed).map(file=>path.join(path.dirname(f.receipt),file.backup))];
  const before=files.map(file=>({bytes:fs.readFileSync(file),mtime:fs.statSync(file).mtimeMs}));let checked=0;
  const result=await execute(f.request('prepare_server_start'),{modRoot:f.mod,inactive:async()=>{checked++;throw Error('Market already running');}});
  assert.equal(result.success,true);assert.equal(checked,0);assert.equal(fs.existsSync(f.pending),false);
  files.forEach((file,i)=>{assert.deepEqual(fs.readFileSync(file),before[i].bytes);assert.equal(fs.statSync(file).mtimeMs,before[i].mtime);});
});
test('server-start preparation automatically repairs a complete updater replacement and preserves settings/history',async t=>{
  const f=fixture(t),stock=upstream(t,f);await f.run('install');stock.replace();
  const Database=require(path.join(process.env.EVEJS_TEST_ROOT||path.resolve(__dirname,'../../EveJS-v0.12.9'),'server/node_modules/better-sqlite3'));
  const file=path.join(f.root,'_local/npc-market-buyers/state.sqlite'),db=new Database(file);
  db.exec("CREATE TABLE nm_meta(key TEXT PRIMARY KEY,value TEXT);INSERT INTO nm_meta VALUES('config','{\"offlinePurchases\":true}');CREATE TABLE nm_activity(id INTEGER PRIMARY KEY,message TEXT);INSERT INTO nm_activity VALUES(1,'Retained sale history')");db.close();
  const saved=fs.readFileSync(file);let checked=0;
  const result=await execute(f.request('prepare_server_start'),{modRoot:f.mod,inactive:async()=>{checked++;}});
  assert.equal(checked,1);assert.match(result.message,/repaired after the EveJS update/);await f.run('verify');
  assert.deepEqual(fs.readFileSync(file),saved);assert.equal(fs.existsSync(f.pending),false);
});
test('server-start updater repair refuses running services before any writes',async t=>{
  const f=fixture(t),stock=upstream(t,f);await f.run('install');stock.replace();
  const receipt=fs.readFileSync(f.receipt);let checked=0;
  await assert.rejects(execute(f.request('prepare_server_start'),{modRoot:f.mod,inactive:async()=>{checked++;throw Error('Game or market running');}}),/Game or market running/);
  assert.equal(checked,1);assert.deepEqual(fs.readFileSync(f.receipt),receipt);assert.equal(fs.existsSync(f.pending),false);
  for(let i=1;i<ALLOWED.length;i++)assert.deepEqual(fs.readFileSync(path.join(f.root,ALLOWED[i])),stock.bytes[i]);
});
test('server-start preparation never installs absent or disabled support',async t=>{
  const f=fixture(t);await assert.rejects(f.run('prepare_server_start'),/Enable NPC Market Buyers/);
  assert.equal(fs.existsSync(f.receipt),false);assert.equal(fs.existsSync(f.pending),false);
  await f.run('install');await f.run('prepare_disable');const receipt=fs.readFileSync(f.receipt);
  await assert.rejects(f.run('prepare_server_start'),/Enable NPC Market Buyers/);
  assert.deepEqual(fs.readFileSync(f.receipt),receipt);
  for(let i=0;i<ALLOWED.length;i++)assert.equal(fs.readFileSync(path.join(f.root,ALLOWED[i]),'utf8'),'original-'+i);
});
test('server-start preparation rejects partial updates and invalid backups without checking services',async t=>{
  const f=fixture(t),stock=upstream(t,f);await f.run('install');
  const run=()=>execute(f.request('prepare_server_start'),{modRoot:f.mod,inactive:async()=>{throw Error('Inactive must not be checked');}});
  fs.writeFileSync(path.join(f.root,ALLOWED[1]),stock.bytes[1]);await assert.rejects(run(),/unrecognized changes/);
  fs.writeFileSync(path.join(f.root,ALLOWED[1]),'replacement-1');
  const receipt=JSON.parse(fs.readFileSync(f.receipt));fs.writeFileSync(path.join(path.dirname(f.receipt),receipt.files[2].backup),'invalid backup');
  await assert.rejects(run(),/backup identity changed/);assert.equal(fs.existsSync(f.pending),false);
});
test('server-start preparation resumes only durable active repair and leaves interrupted disable manual',async t=>{
  const f=fixture(t),stock=upstream(t,f);await f.run('install');stock.replace();
  const rename=fs.renameSync;let swaps=0;
  fs.renameSync=(from,to)=>{if(to.startsWith(path.join(f.root,'externalservices'))&&++swaps===3)throw Error('Interrupted auto repair');return rename(from,to);};
  try{await assert.rejects(f.run('prepare_server_start'),/Interrupted auto repair/);}finally{fs.renameSync=rename;}
  await f.run('prepare_server_start');await f.run('verify');assert.equal(fs.existsSync(f.pending),false);
  const receipt=JSON.parse(fs.readFileSync(f.receipt));fs.writeFileSync(f.pending,JSON.stringify({desired:'restored',receipt}));
  const pending=fs.readFileSync(f.pending),before=ALLOWED.map(target=>fs.readFileSync(path.join(f.root,target)));
  await assert.rejects(f.run('prepare_server_start'),/manual recovery/);
  assert.deepEqual(fs.readFileSync(f.pending),pending);ALLOWED.forEach((target,i)=>assert.deepEqual(fs.readFileSync(path.join(f.root,target)),before[i]));
});
test('native guard cannot be removed while settlement or history is still pending',t=>{
  const f=fixture(t),Database=require(path.join(process.env.EVEJS_TEST_ROOT||path.resolve(__dirname,'../../EveJS-v0.12.9'),'server/node_modules/better-sqlite3'));
  const file=path.join(f.root,'_local/npc-market-buyers/state.sqlite');fs.mkdirSync(path.dirname(file),{recursive:true});
  const db=new Database(file);db.exec("CREATE TABLE nm_native_ops(state TEXT);INSERT INTO nm_native_ops VALUES ('pending')");
  assert.throws(()=>assertNoPending(f.root,{Database}),/settlement needs recovery/);
  db.exec("UPDATE nm_native_ops SET state='settled'; CREATE TABLE nm_native_outbox(state TEXT); INSERT INTO nm_native_outbox VALUES ('pending')");
  assert.throws(()=>assertNoPending(f.root,{Database}),/settlement needs recovery/);
  db.exec("UPDATE nm_native_outbox SET state='sent'");assert.doesNotThrow(()=>assertNoPending(f.root,{Database}));db.close();
});
