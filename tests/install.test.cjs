"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {ALLOWED,execute,assertNoPending}=require('../lib/install');
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
test('rebuilt files do not block verify or removal; missing backups still prevent destructive restoration',async t=>{
  const f=fixture(t);await f.run('install');fs.writeFileSync(path.join(f.root,ALLOWED[4]),'another-mod');
  await f.run('verify');await f.run('prepare_disable');
  assert.equal(fs.readFileSync(path.join(f.root,ALLOWED[4]),'utf8'),'original-4');
  await f.run('install');fs.unlinkSync(path.join(path.dirname(f.receipt),'backup/0.bin'));
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
  for(const file of receipt.files){delete file.existed;file.baseSHA='obsolete';file.installedSHA='obsolete';}
  fs.writeFileSync(f.receipt,JSON.stringify(receipt));await f.run('verify');
  fs.unlinkSync(path.join(f.root,ALLOWED[0]));await f.run('install');
  await f.run('prepare_disable');
  for(const [i,file]of f.files.entries())assert.equal(fs.readFileSync(path.join(f.root,file.target),'utf8'),'original-'+i);
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
