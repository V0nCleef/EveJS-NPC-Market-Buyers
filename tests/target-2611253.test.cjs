'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.EVEJS_TEST_ROOT;
const version=root&&JSON.parse(fs.readFileSync(path.join(root,'server/package.json'))).version;
const selected=['261125.3','261126.2'].includes(version);
const modRoot=path.resolve(__dirname,'..');
test(`${version} market and wallet transforms retain guarded seams on typed shared-store host`,{skip:!selected},()=>{
 const raw=fs.readFileSync(path.join(root,'server/src/services/market/marketProxyService.js'),'utf8');
 const prepare=require('../lib/marketAdapter').prepareMarketSource;
 new vm.Script(prepare(raw));
 assert.throws(()=>prepare(raw.replace('async function executePlayerSellFillSagaUnlocked(','async function unknown(')),/seam missing/);
 if(version==='261126.2')assert.throws(()=>prepare(raw.replace('return walletOwner.id * 16 + division;','return walletOwner.id * 8 + division;')),/corporation history wallet account IDs/);
 for(const [file,isCorp] of [['account/walletState.js',false],['corporation/corpWalletState.js',true]])
  new vm.Script(require('../lib/walletBatching').prepareWalletSource(fs.readFileSync(path.join(root,'server/src/services',file),'utf8'),isCorp));
 const schema=require(path.join(root,'server/src/gameStore/shared-schema/version'));
 assert.equal(schema.SCHEMA_VERSION,35);
 for(const table of ['characters','items','marketEscrow','walletAuthorityState'])assert.ok(schema.TYPED_TABLES.has(table));
});
test(`${version} Docker lifecycle accepts reviewed host and refuses unknown host or seam before receipt writes`,{skip:!selected},async t=>{
 const base=path.resolve(__dirname,'../.test-runtime');fs.mkdirSync(base,{recursive:true});
 const dir=fs.mkdtempSync(path.join(base,'docker-2611253-'));
 t.after(()=>{assert.ok(dir.startsWith(base+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 for(const file of ['package.json','src/services/market/marketProxyService.js','src/services/account/walletState.js','src/services/corporation/corpWalletState.js']){
  const out=path.join(dir,'server',file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(path.join(root,'server',file),out);
 }
 const h=require('../docker/helper-v1.cjs'),lifecycle=require('../docker/server-lifecycle.cjs'),original=h.context;
 const stateRoot=path.join(dir,'data/mods/npc-market-buyers');
 h.context=()=>({root:dir,modRoot,stateRoot,descriptor:require('../evejs-launcher.mod.json'),installationIdentity:'isolated-2611253'});
 try{
  const request={action:'install',protocol:h.PROTOCOL,requestId:'fixture'};
  assert.equal((await lifecycle.execute(request,{modRoot})).success,true);
  const receipt=path.join(stateRoot,'install/docker-receipt.json'),before=fs.readFileSync(receipt);
  fs.writeFileSync(path.join(dir,'server/package.json'),'{"version":"unknown"}');
  await assert.rejects(lifecycle.execute(request,{modRoot}),/reviewed EveJS/);assert.deepEqual(fs.readFileSync(receipt),before);
  fs.copyFileSync(path.join(root,'server/package.json'),path.join(dir,'server/package.json'));
  const market=path.join(dir,'server/src/services/market/marketProxyService.js');
  fs.writeFileSync(market,fs.readFileSync(market,'utf8').replace('async function executePlayerSellFillSagaUnlocked(','async function unknown('));
  await assert.rejects(lifecycle.execute(request,{modRoot}),/seam missing/);assert.deepEqual(fs.readFileSync(receipt),before);
 }finally{h.context=original;}
});
