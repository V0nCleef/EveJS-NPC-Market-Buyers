'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {prepareMarketSource}=require('../lib/marketAdapter');
const root=process.env.EVEJS_TEST_ROOT;
const source=prepareMarketSource(fs.readFileSync(path.join(root,'server/src/services/market/marketProxyService.js'),'utf8'));
function extract(name){const match=new RegExp(`^async function ${name}\\(`,'m').exec(source);assert.ok(match,name);
  const tail=source.slice(match.index),next=/\n(?:async )?function [A-Za-z]/.exec(tail);return tail.slice(0,next.index);}
test('261115.2 corporation wallets retain ordinary dedupe/refunds and exact prior NPC authority fingerprints',async()=>{
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'server/package.json'))).version,'261115.2');
  const calls=[],ack=[],funds=[];
  const ctx={roundIsk:Number,normalizeCorporationWalletKey:Number,JOURNAL_ENTRY_TYPE:{ADMIN_ADJUSTMENT:1},
    ensureCharacterHasFunds:(...args)=>funds.push(args),throwWrappedUserError:()=>assert.fail('wallet rejected'),
    adjustCorporationWalletDivisionBalanceAsync:async(...args)=>{calls.push(args);return {success:true};},
    adjustCharacterBalanceAsync:async(...args)=>{calls.push(args);return {success:true};},
    __npcMarketBuyerBridge:{walletMetadata:options=>options.idempotencyKey.startsWith('npc-market:')?{commandID:options.idempotencyKey,source:'npc-market-buyers'}:{},
      walletAcknowledged:options=>ack.push(options.idempotencyKey),hasWalletReceipt:options=>options.replay===true}};
  vm.createContext(ctx);vm.runInContext(extract('debitCharacterWallet')+'\n'+extract('creditCharacterWallet'),ctx);
  await ctx.creditCharacterWallet(20,25,'refund',30,{isCorp:true,accountKey:1002,idempotencyKey:'market:terminal:1',walletSource:'market-terminal-refund'});
  assert.equal(calls[0][3].idempotencyKey,'market:terminal:1');
  assert.equal(calls[0][4].source,'market-terminal-refund');assert.equal(calls[0][4].commandID,undefined);
  for(const operation of ['creditCharacterWallet','debitCharacterWallet']){
    const key='npc-market:test:wallet:'+operation;
    await ctx[operation](20,25,'NPC leg',30,{isCorp:true,accountKey:1002,idempotencyKey:key,replay:true});
    const args=calls.at(-1);assert.equal(Object.hasOwn(args[3],'idempotencyKey'),false,'retain exact 0.1.24 owner-command payload');assert.equal(args[4].commandID,key);
    assert.equal(args[4].source,'npc-market-buyers');assert.equal(args[1],1002);
    const legacy={description:'NPC leg',ownerID1:operation==='creditCharacterWallet'?30:20,
      ownerID2:operation==='creditCharacterWallet'?20:30,referenceID:30,entryTypeID:1};
    // Use the target owner's actual canonicalization/fingerprint functions.
    const ownerSource=fs.readFileSync(path.join(root,'server/src/services/account/walletAuthorityReceiptState.js'),'utf8');
    const pure=ownerSource.slice(ownerSource.indexOf('function canonicalize('),ownerSource.indexOf('function resolveReceiptTarget('));
    const owner={crypto:require('node:crypto')};vm.createContext(owner);vm.runInContext(pure,owner);
    const payload=options=>({corporationID:20,accountKey:1002,delta:args[2],options});
    assert.equal(owner.fingerprint('corporation.adjust-isk',payload(args[3])),owner.fingerprint('corporation.adjust-isk',payload(legacy)));
  }
  assert.equal(funds.length,0,'replayed debit uses its durable receipt');assert.equal(ack.length,3);
});
test('changed 261115.2 corporation call still fails closed',()=>{
  const raw=fs.readFileSync(path.join(root,'server/src/services/market/marketProxyService.js'),'utf8').replace(/\r\n/g,'\n');
  assert.throws(()=>prepareMarketSource(raw.replace('      { source: options.walletSource },','      { source: options.changedSource },')),/corporation command ID/);
});
test('Docker lifecycle fixture validates new host seams before writing persistent receipts',async t=>{
  // Host context is deliberately simulated. This is not Linux/Docker runtime proof.
  const h=require('../docker/helper-v1.cjs'),lifecycle=require('../docker/server-lifecycle.cjs');
  const scratch=path.resolve(__dirname,'../.test-runtime');fs.mkdirSync(scratch,{recursive:true});
  const dir=fs.mkdtempSync(path.join(scratch,'docker-target-')),modRoot=path.resolve(__dirname,'..');
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for(const file of ['package.json','src/services/market/marketProxyService.js','src/services/account/walletState.js','src/services/corporation/corpWalletState.js']){
    const out=path.join(dir,'server',file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(path.join(root,'server',file),out);
  }
  const stateRoot=path.join(dir,'data/mods/npc-market-buyers'),descriptor=require('../evejs-launcher.mod.json');
  const original=h.context;h.context=()=>({root:dir,modRoot,stateRoot,descriptor,installationIdentity:'isolated-fixture'});
  try{
    const request={action:'install',protocol:h.PROTOCOL,requestId:'fixture'};
    assert.equal((await lifecycle.execute(request,{modRoot})).success,true);
    const receipt=path.join(stateRoot,'install/docker-receipt.json'),before=fs.readFileSync(receipt);
    const market=path.join(dir,'server/src/services/market/marketProxyService.js');
    fs.writeFileSync(market,fs.readFileSync(market,'utf8').replace('async function executePlayerSellFillSagaUnlocked(','async function changed('));
    await assert.rejects(lifecycle.execute(request,{modRoot}),/seam missing/);assert.deepEqual(fs.readFileSync(receipt),before);
  }finally{h.context=original;}
});
