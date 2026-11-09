'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execute,ALLOWED}=require('../lib/install');
const {PROTOCOL,COMPATIBILITY,FINANCIAL}=require('../lib/activeUpdate');
const identities=require('../lib/nativeIdentities.json');
const {createStore}=require('../lib/store'),{createEngine}=require('../lib/engine'),{createNativeBridge}=require('../lib/settlement');
const databaseModule=path.join(process.env.EVEJS_TEST_ROOT||path.resolve(__dirname,'../../EveJS-v0.12.9'),'server/node_modules/better-sqlite3');
const Database=require(databaseModule),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t,{seedPending=true,fromVersion='0.1.20'}={}){
  const scratch=path.resolve(__dirname,'../.test-runtime');fs.mkdirSync(scratch,{recursive:true});
  const temp=fs.mkdtempSync(path.join(scratch,'active-update-')),root=path.join(temp,'evejs');
  const old=path.join(root,'mods/previous-npc'),incoming=path.join(root,'staging/incoming-npc');
  const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
  write(path.join(root,'server/package.json'),'{}');
  write(path.join(root,'server/node_modules/better-sqlite3/index.js'),'module.exports=require('+JSON.stringify(databaseModule)+');');
  const oldBytes=ALLOWED.map((_,i)=>Buffer.from('known-prior-payload-'+i)),newBytes=ALLOWED.map((_,i)=>Buffer.from('incoming-payload-'+i));
  const known={version:'fixture-only',sha256:oldBytes.map(sha)};identities.legacyPayloads.push(known);
  for(const [mod,version,bytes]of [[old,fromVersion,oldBytes],[incoming,'0.1.23',newBytes]]){
    const manifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../evejs-launcher.mod.json')));manifest.version=version;
    if(version==='0.1.20')delete manifest.launcherApi.enabledUpdate;
    write(path.join(mod,'evejs-launcher.mod.json'),JSON.stringify(manifest));write(path.join(mod,'package.json'),JSON.stringify({version}));
    write(path.join(mod,'loader.js'),'// enabled fixture');
    for(const name of ['i18n.py','sell_advisor.py','hud.py','companion.py','wallet_summary.py'])write(path.join(mod,'client',name),'# fixture');
    for(const name of FINANCIAL)write(path.join(mod,'lib',name),fs.readFileSync(path.resolve(__dirname,mod===old?'fixtures/financial-v1':'../lib',name)));
    for(const [i,target]of ALLOWED.entries()){
      write(path.join(mod,'payload/native',i+'.bin'),bytes[i]);
      if(mod===old)write(path.join(root,target),'uninstall-original-'+i);
    }
    write(path.join(mod,'payload/native.json'),JSON.stringify({schema:2,files:ALLOWED.map((target,i)=>({target,payload:`native/${i}.bin`}))}));
  }
  const stateFile=path.join(root,'_local/npc-market-buyers/state.sqlite');
  const store=createStore(stateFile,{Database});
  const bridge=createNativeBridge({});bridge.attach(store);
  createEngine({store,adapter:{},getConfig:()=>store.getConfig()});
  const key='npc-market:synthetic:pending';
  const order={orderID:'42',sellerID:2,ownerID:2,typeID:34,stationID:60003760,price:10,quantity:100};
  if(seedPending){store.db.prepare(`INSERT INTO nm_operations(operation_key,cycle_id,group_key,day,seller_id,type_id,quantity,cost_cents,state,order_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(key,'cycle','2:34:60003760','2026-10-29',2,34,10,10000,'pending',JSON.stringify(order),1,1);
  store.db.prepare('INSERT INTO nm_native_ops VALUES (?,?,?,?,?,?,?,?)').run(key,'fixture','pending',JSON.stringify(order),10,JSON.stringify({operationKey:key,status:'forward'}),null,1);
  store.db.prepare('INSERT INTO nm_wallet_intents VALUES (?,?,?,?)').run(key+':wallet:tax-debit',2,0,'pending');}
  const transactionId=crypto.randomUUID();
  const request=action=>({protocol:'evejs-launcher-mod-helper-v1',requestId:'test',action,runtime:{backend:'native',evejsRoot:root},
    update:{protocol:PROTOCOL,transactionId,fromVersion,fromModRoot:old,toVersion:'0.1.23'}});
  const run=(action,changes={})=>execute({...request(action),...changes},{modRoot:incoming,inactive:async()=>{}});
  const receipt=path.join(root,'_local/npc-market-buyers/install/receipt.json'),pending=path.join(path.dirname(receipt),'pending.json');
  const financial=()=>JSON.stringify(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'nm_*' ORDER BY name").all()
    .map(({name})=>({name,rows:store.db.prepare('SELECT * FROM '+name).all()})));
  t.after(()=>{
    store.close();identities.legacyPayloads.splice(identities.legacyPayloads.indexOf(known),1);
    if(!temp.startsWith(scratch+path.sep))throw Error('Invalid fixture cleanup target');
    fs.rmSync(temp,{recursive:true,force:true});
  });
  return {root,old,incoming,oldBytes,newBytes,store,request,run,receipt,pending,financial,
    async installOld(){await execute(request('install'),{modRoot:old,inactive:async()=>{}});
      const value=JSON.parse(fs.readFileSync(receipt));value.version='0.1.19';fs.writeFileSync(receipt,JSON.stringify(value,null,2)+'\n');},
    native:()=>ALLOWED.map(target=>fs.existsSync(path.join(root,target))?fs.readFileSync(path.join(root,target)):null)};
}
function officialReplacement(t,f,{missingExe=false}={}){
  const bytes=ALLOWED.map((_,i)=>Buffer.from('official-upstream-'+i));
  const baseline={id:'upstream-fixture-'+crypto.randomUUID(),sha256:[null,...bytes.slice(1).map(sha)]};
  identities.baselines.push(baseline);t.after(()=>identities.baselines.splice(identities.baselines.indexOf(baseline),1));
  for(let i=1;i<ALLOWED.length;i++)fs.writeFileSync(path.join(f.root,ALLOWED[i]),bytes[i]);
  if(missingExe)fs.unlinkSync(path.join(f.root,ALLOWED[0]));return {bytes,baseline};
}
test('opt-in enabled update retains pending finance and uninstall originals; real disable still refuses',async t=>{
  const f=fixture(t);await f.installOld();const before=f.financial(),receipt=JSON.parse(fs.readFileSync(f.receipt));
  await assert.rejects(f.run('prepare_disable'),/settlement needs recovery/);
  await f.run('prepare_update');assert.deepEqual(f.native(),f.oldBytes);assert.equal(f.financial(),before);
  const moved=f.old+'-launcher-backup';fs.renameSync(f.old,moved); // Launcher replaces folder after prepare.
  await f.run('apply_update');await f.run('verify');assert.deepEqual(f.native(),f.newBytes);
  const afterApply=fs.readFileSync(f.receipt);await f.run('apply_update');assert.deepEqual(fs.readFileSync(f.receipt),afterApply);
  assert.equal(f.financial(),before);await f.run('commit_update');await f.run('commit_update');
  const applied=JSON.parse(fs.readFileSync(f.receipt));assert.equal(applied.state,'active');assert.equal(applied.version,'0.1.23');
  assert.deepEqual(applied.files.map(r=>[r.backup,r.baseSHA]),receipt.files.map(r=>[r.backup,r.baseSHA]));
  await assert.rejects(f.run('prepare_disable'),/settlement needs recovery/);await assert.rejects(f.run('prepare_remove'),/settlement needs recovery/);
  assert.equal(f.financial(),before);assert.equal(fs.existsSync(path.join(path.dirname(f.receipt),'active-update.json')),false);
});

test('known 0.1.22 financial ABI updates to changed 0.1.23 bridge without touching pending work',async t=>{
  const f=fixture(t,{fromVersion:'0.1.22'});await f.installOld();const before=f.financial();
  assert.notDeepEqual(fs.readFileSync(path.join(f.old,'lib/settlement.js')),fs.readFileSync(path.join(f.incoming,'lib/settlement.js')));
  await f.run('prepare_update');await f.run('apply_update');await f.run('commit_update');
  assert.equal(f.financial(),before);assert.deepEqual(f.native(),f.newBytes);
  assert.equal(JSON.parse(fs.readFileSync(f.receipt)).version,'0.1.23');
});

test('actual disable and removal refuse a pending orphan journal even with no pending engine/native row',async t=>{
  const f=fixture(t,{seedPending:false});await f.installOld();
  f.store.db.exec(`CREATE TABLE nm_orphan_recovery(operation_key TEXT PRIMARY KEY,schema INTEGER NOT NULL,plan_json TEXT NOT NULL,
    plan_sha TEXT NOT NULL,progress_json TEXT NOT NULL,state TEXT NOT NULL,updated_at INTEGER NOT NULL)`);
  f.store.db.prepare('INSERT INTO nm_orphan_recovery VALUES (?,?,?,?,?,?,?)').run('orphan',1,'{}','hash','{}','pending',1);
  const before=f.financial(),receipt=fs.readFileSync(f.receipt);
  await assert.rejects(f.run('prepare_disable'),/settlement needs recovery/);
  await assert.rejects(f.run('prepare_remove'),/settlement needs recovery/);
  assert.equal(f.financial(),before);assert.deepEqual(fs.readFileSync(f.receipt),receipt);
});
test('failure before first native write and halfway through native apply restores exact previous bytes and receipt',async t=>{
  for(const failAt of [1,3]){
    const f=fixture(t);await f.installOld();const raw=fs.readFileSync(f.receipt),finance=f.financial();await f.run('prepare_update');
    const rename=fs.renameSync;let swaps=0;
    fs.renameSync=(from,to)=>{if(to.startsWith(path.join(f.root,'externalservices'))&&++swaps===failAt)throw Error('Injected native replacement failure');return rename(from,to);};
    try{await assert.rejects(f.run('apply_update'),/Injected native/);}finally{fs.renameSync=rename;}
    await f.run('rollback_update');await f.run('rollback_update');
    assert.deepEqual(f.native(),f.oldBytes);assert.deepEqual(fs.readFileSync(f.receipt),raw);assert.equal(f.financial(),finance);assert.equal(fs.existsSync(f.pending),false);
  }
});
test('post-apply package failure can roll native support back before restoring the old package',async t=>{
  const f=fixture(t);await f.installOld();const raw=fs.readFileSync(f.receipt),finance=f.financial();await f.run('prepare_update');
  await f.run('apply_update');await f.run('rollback_update');assert.deepEqual(f.native(),f.oldBytes);assert.deepEqual(fs.readFileSync(f.receipt),raw);assert.equal(f.financial(),finance);
});
test('unrelated native edits or restore intent never get overwritten through active update',async t=>{
  const f=fixture(t);await f.installOld();await f.run('prepare_update');const finance=f.financial();
  const changed=path.join(f.root,ALLOWED[4]);fs.writeFileSync(changed,'unrelated-native-edit');
  await assert.rejects(f.run('apply_update'),/Native file changed/);await assert.rejects(f.run('rollback_update'),/Native file changed/);
  assert.equal(fs.readFileSync(changed,'utf8'),'unrelated-native-edit');assert.equal(f.financial(),finance);
  fs.writeFileSync(changed,f.oldBytes[4]);fs.writeFileSync(f.pending,JSON.stringify({desired:'restored',receipt:JSON.parse(fs.readFileSync(f.receipt))}));
  await assert.rejects(f.run('rollback_update'),/Unrelated native installation intent/);assert.equal(fs.existsSync(f.pending),true);
});
test('incoming contract and legacy source/backend/schema provenance are checked before snapshots',async t=>{
  const f=fixture(t);await f.installOld();const finance=f.financial();
  await assert.rejects(f.run('prepare_update',{runtime:{backend:'docker',evejsRoot:f.root}}),/Native backend/);
  await assert.rejects(f.run('prepare_update',{update:{...f.request('prepare_update').update,fromVersion:'0.1.18'}}),/Invalid enabled/);
  const ownManifest=path.join(f.incoming,'evejs-launcher.mod.json'),manifest=JSON.parse(fs.readFileSync(ownManifest));
  manifest.launcherApi.enabledUpdate.compatibility='unknown';fs.writeFileSync(ownManifest,JSON.stringify(manifest));
  await assert.rejects(f.run('prepare_update'),/Invalid enabled/);manifest.launcherApi.enabledUpdate.compatibility=COMPATIBILITY;fs.writeFileSync(ownManifest,JSON.stringify(manifest));
  const engine=path.join(f.old,'lib/engine.js'),source=fs.readFileSync(engine);fs.appendFileSync(engine,'\n// changed financial protocol');
  await assert.rejects(f.run('prepare_update'),/financial protocol changed/);fs.writeFileSync(engine,source);
  f.store.db.exec('ALTER TABLE nm_native_ops ADD COLUMN unknown_protocol TEXT');
  await assert.rejects(f.run('prepare_update'),/Incompatible NPC settlement columns/);
  f.store.db.exec('ALTER TABLE nm_native_ops DROP COLUMN unknown_protocol');assert.equal(f.financial(),finance);
  assert.equal(fs.existsSync(path.join(path.dirname(f.receipt),'active-update.json')),false);
});
test('terminal cleanup after a crash refuses file/receipt drift without laundering its last-update marker',async t=>{
  for(const action of ['commit_update','rollback_update'])for(const drift of ['file','receipt'])for(const upstream of [false,true]){
    const f=fixture(t);await f.installOld();if(upstream)officialReplacement(t,f,{missingExe:true});await f.run('prepare_update');await f.run('apply_update');
    const unlink=fs.unlinkSync;let removed=0;
    fs.unlinkSync=file=>{if(file.includes(path.sep+'update-backup'+path.sep)&&++removed===2)throw Error('Crash during partial cleanup');return unlink(file);};
    try{await assert.rejects(f.run(action),/Crash during partial cleanup/);}finally{fs.unlinkSync=unlink;}
    const marker=path.join(path.dirname(f.receipt),'last-update.json'),beforeMarker=fs.readFileSync(marker),finance=f.financial();
    const target=drift==='file'?path.join(f.root,ALLOWED[4]):f.receipt,original=fs.readFileSync(target);
    fs.appendFileSync(target,drift==='file'?'unrelated source edit':' ');
    const changed=fs.readFileSync(target);
    await assert.rejects(f.run(action),/Terminal enabled NPC update files or receipt changed/);
    assert.deepEqual(fs.readFileSync(marker),beforeMarker);assert.deepEqual(fs.readFileSync(target),changed);assert.equal(f.financial(),finance);
    fs.writeFileSync(target,original);await f.run(action);await f.run(action);
    fs.appendFileSync(target,' ');
    await assert.rejects(f.run(action),/No matching completed enabled NPC update receipt/);
    assert.deepEqual(fs.readFileSync(marker),beforeMarker);
  }
});
test('the unchanged real settlement bridge/saga replays an interrupted tax acknowledgement once after enabled update',async t=>{
  const f=fixture(t,{seedPending:false});await f.installOld();
  const vm=require('node:vm'),{prepareMarketSource}=require('../lib/marketAdapter');
  const source=prepareMarketSource(fs.readFileSync(path.join(process.env.EVEJS_TEST_ROOT||path.resolve(__dirname,'../../EveJS-v0.12.9'),'server/src/services/market/marketProxyService.js'),'utf8'));
  const extract=name=>{const match=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(source);assert.ok(match,name);const tail=source.slice(match.index),next=/\n(?:async )?function [A-Za-z]/.exec(tail);return next?tail.slice(0,next.index):tail;};
  const clone=value=>JSON.parse(JSON.stringify(value));
  const characters=new Map([[2,{accountId:1}]]),balances=new Map([[2,0]]),receipts=new Map(),moves=new Map(),fills=new Map(),history=new Map();
  let escrow={orderId:'42',ownerId:2,walletOwnerId:2,remainingQuantity:100},loseTax=true,bridge;
  const current={order_id:'42',owner_id:2,is_corp:false,source:'player',state:'open',
    row:{order_id:'42',type_id:34,station_id:60003760,region_id:10000002,price:10,vol_entered:100,vol_remaining:100,bid:false}};
  async function wallet(id,amount,options){
    const key=options.idempotencyKey;bridge.walletMetadata(options,id,false);
    if(!receipts.has(key)){balances.set(id,(balances.get(id)||0)+amount);receipts.set(key,amount);}
    if(key.endsWith(':tax-debit')&&loseTax){loseTax=false;throw Error('Authority client is shutting down after committed tax; acknowledgement lost');}
    bridge.walletAcknowledged(options,{success:true});return {success:true};
  }
  const persist=(_anchor,saga)=>{escrow={...escrow,pendingFill:clone(saga)};};
  const context={
    persistPlayerSellFillSaga:persist,debitCharacterWallet:(id,amount,_d,_o,options)=>wallet(id,-amount,options),
    creditCharacterWallet:(id,amount,_d,_o,options)=>wallet(id,amount,options),flushCharacterWalletSagaBoundary:()=>{},
    ITEM_FLAGS:{HANGAR:4},JOURNAL_ENTRY_TYPE:{MARKET_TRANSACTION:2,TRANSACTION_TAX:54,MARKET_ESCROW:42},
    itemCustody:{CUSTODY_REASON:{MARKET_ESCROW_DELIVER:'deliver',MARKET_FILL_COMPENSATE:'undo'}},
    marketItemCustody:{getEscrowLocationID:()=>9000042,transferItem:input=>{
      if(!moves.has(input.idempotencyKey))moves.set(input.idempotencyKey,{itemID:11,ownerID:input.ownerID,quantity:input.quantity});
      return {success:true,data:{item:moves.get(input.idempotencyKey)}};}},
    throwWrappedUserError:(_code,info)=>{throw Error(info.info);},
    marketDaemonClient:{call:async(method,params)=>{assert.equal(method,'FillOrder');
      if(!fills.has(params.idempotency_key)){current.row.vol_remaining-=params.fill_quantity;fills.set(params.idempotency_key,{filled_quantity:params.fill_quantity,vol_remaining:current.row.vol_remaining,state:'open',price:10});}
      return fills.get(params.idempotency_key);}},
    requireDurableMarketSagaWrite:result=>assert.equal(result.success,true),recordCompletedMarketFillAchievements:()=>({success:true}),
    removeEscrowRecordDurable:()=>{escrow=null;return {success:true};},putEscrowRecordDurable:value=>{escrow=clone(value);return {success:true};},
    getEscrowRecord:()=>escrow,computeOrderValue:(price,quantity)=>price*quantity,queueDurableMarketFillRecovery:async()=>{},
  };
  vm.createContext(context);vm.runInContext(['isDefinitiveMarketDaemonRejection','canCompensateRejectedPrimaryFill','compensatePlayerSellFillSaga','executePlayerSellFillSagaUnlocked'].map(extract).join('\n'),context);
  const native={
    database:{read:()=>({success:true,data:Object.fromEntries(characters)}),write:(_table,key,value)=>{characters.set(Number(key.slice(1)),value);balances.set(Number(key.slice(1)),value.balance);return {success:true};},flushTableSync:()=>({success:true})},
    marketDaemonClient:{call:async()=>({capabilities:['conditional-fill-v1']})},authority:{isWalletAuthorityProcessEnabled:()=>true},
    characters:{peekCharacterRecord:id=>characters.get(id)},allocator:{reserveCharacterID:()=>3},
    getStationRecord:()=>({regionID:10000002}),getStationSolarSystemID:()=>30000142,getStationConstellationID:()=>20000020,
    listEscrowRecords:()=>escrow?[escrow]:[],getEscrowRecord:()=>escrow,fetchOrderById:async()=>current,getOwnerOrderResponseOrder:value=>value.row,
    walletReceipts:{findOwnerReceipt:(_owner,key)=>receipts.has(key)?{commandID:key}:null,isOwnerReceiptListSaturated:()=>false},
    wallet:{JOURNAL_ENTRY_TYPE:{GM_CASH_TRANSFER:3},getCharacterWallet:id=>({balance:balances.get(id)||0}),
      adjustCharacterBalanceAsync:(id,amount,options)=>wallet(id,amount,options),
      appendCharacterMarketTransactionAsync:async(id,entry,meta)=>{history.set(meta.commandID,{id,entry});return {success:true};}},
    corpWallet:{},buildCharacterMarketContext:()=>({}),computeSalesTaxAmount:(_c,value)=>value*.01,getMarketCounterpartyOwnerID:()=>1000009,notifyOwnOrdersChanged:()=>{},
    buildPlayerSellFillSaga:input=>({schemaVersion:1,direction:'buyer-consumes-player-sell',status:'forward',orderID:'42',attempt:1,
      buyerCharacterID:input.buyerCharacterID,buyerWalletID:input.buyerCharacterID,sellerCharacterID:2,sellerWalletID:2,buyerIsCorp:false,sellerIsCorp:false,
      destinationStationID:60003760,typeID:34,tradedQuantity:input.tradedQuantity,availableQuantity:100,orderPrice:10,grossCost:input.grossCost,salesTax:input.salesTax,
      stationMarketOwnerID:1000009,chargeBuyerWallet:true,buyerDebited:false,sellerCredited:false,taxDebited:false,daemonAttempted:false,fillResponse:null,
      itemLegs:[{sourceItem:{itemID:10},quantity:input.tradedQuantity,destinationItem:null,compensated:false}],createdAt:new Date(0).toISOString()}),
    persistPlayerSellFillSaga:persist,executePlayerSellFillSaga:(anchor,saga)=>context.executePlayerSellFillSagaUnlocked(anchor,saga,'Tritanium'),
  };
  bridge=createNativeBridge(native);bridge.attach(f.store);context.__npcMarketBuyerBridge=bridge;
  let clock=0,paused=false;
  const config={...f.store.getConfig(),randomBatch:false};
  const options={store:f.store,adapter:{listOrders:()=>{assert.equal(paused,false,'Paused recovery must not list new orders');return bridge.listOrders();},buy:bridge.buy,recover:bridge.recover},
    getConfig:()=>({...config,enabled:!paused}),quotes:{get:async()=>{assert.equal(paused,false);return {dailyVolume:1000000,updatedAt:clock};}},
    evaluate:()=>({eligible:true,chancePercent:100,maxQuantity:10}),clock:()=>clock,random:()=>0,log:{error(){}}};
  let engine=createEngine(options);await engine.runCycle();clock=900000;await assert.rejects(engine.runCycle(),/Authority client is shutting down/);
  const operation=f.store.db.prepare("SELECT * FROM nm_operations WHERE state='pending'").get(),key=operation.operation_key;
  assert.equal(escrow.pendingFill.buyerDebited,true);assert.equal(escrow.pendingFill.sellerCredited,true);assert.equal(escrow.pendingFill.taxDebited,false);
  assert.equal(JSON.parse(f.store.db.prepare('SELECT saga_json FROM nm_native_ops WHERE operation_key=?').get(key).saga_json).buyerDebited,false);
  const financial=f.financial();await engine.stop();await f.run('prepare_update');await f.run('apply_update');await f.run('commit_update');assert.equal(f.financial(),financial);
  paused=true;engine=createEngine(options);await engine.runCycle();await engine.runCycle();await bridge.recover();
  const result=await bridge.buy(JSON.parse(operation.order_json),operation.quantity,key);assert.equal(result.state,'settled');
  assert.equal(engine.status().pending,0);assert.equal(balances.get(2),99);assert.equal(balances.get(3),0);
  assert.equal(receipts.size,4);assert.equal(receipts.get(key+':wallet:tax-debit'),-1);assert.equal(moves.size,1);assert.equal(fills.size,1);assert.equal(history.size,2);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM nm_sales WHERE operation_key=?').get(key).n,1);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM nm_activity WHERE kind='purchase' AND operation_key=?").get(key).n,1);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM nm_native_outbox WHERE state='pending'").get().n,0);assert.equal(escrow.pendingFill,null);
  await engine.stop();
});
test('pending settlements survive an enabled update after a coherent official EveJS source upgrade',async t=>{
  for(const missingExe of [false,true]){
    const f=fixture(t);await f.installOld();const oldReceipt=JSON.parse(fs.readFileSync(f.receipt)),stock=officialReplacement(t,f,{missingExe});
    const before=f.native(),finance=f.financial();await f.run('prepare_update');assert.deepEqual(f.native(),before);
    await f.run('apply_update');const applied=JSON.parse(fs.readFileSync(f.receipt));
    assert.equal(applied.state,'active');assert.equal(applied.version,'0.1.23');assert.equal(applied.files[0].existed,false);
    assert.notEqual(applied.files[1].backup,oldReceipt.files[1].backup);
    for(let i=1;i<ALLOWED.length;i++)assert.deepEqual(fs.readFileSync(path.join(path.dirname(f.receipt),applied.files[i].backup)),stock.bytes[i]);
    await f.run('commit_update');assert.equal(f.financial(),finance);await assert.rejects(f.run('prepare_disable'),/settlement needs recovery/);
  }
});
test('an interrupted official rebase rolls back the pre-update native files, their original absence and exact raw receipt',async t=>{
  for(const missingExe of [false,true]){
    const f=fixture(t);await f.installOld();officialReplacement(t,f,{missingExe});
    const before=f.native(),raw=fs.readFileSync(f.receipt),finance=f.financial();await f.run('prepare_update');
    const rename=fs.renameSync;let count=0;
    fs.renameSync=(from,to)=>{if(to.startsWith(path.join(f.root,'externalservices'))&&++count===3)throw Error('Interrupted rebased apply');return rename(from,to);};
    try{await assert.rejects(f.run('apply_update'),/Interrupted rebased apply/);}finally{fs.renameSync=rename;}
    const journal=JSON.parse(fs.readFileSync(path.join(path.dirname(f.receipt),'active-update.json')));
    assert.ok(journal.plannedReceipt);await f.run('rollback_update');await f.run('rollback_update');
    assert.deepEqual(f.native(),before);assert.deepEqual(fs.readFileSync(f.receipt),raw);assert.equal(f.financial(),finance);
    for(const file of journal.plannedReceipt.files)assert.equal(fs.existsSync(path.join(path.dirname(f.receipt),file.backup)),false);
  }
});
test('the rebase generation is durable before its first backup and resumes the same plan after a backup failure',async t=>{
  const f=fixture(t);await f.installOld();officialReplacement(t,f);const finance=f.financial();await f.run('prepare_update');
  const rename=fs.renameSync;let count=0;
  fs.renameSync=(from,to)=>{if(to.includes(path.sep+'install'+path.sep+'backup'+path.sep)&&++count===2)throw Error('Interrupted planned backup');return rename(from,to);};
  try{await assert.rejects(f.run('apply_update'),/Interrupted planned backup/);}finally{fs.renameSync=rename;}
  const file=path.join(path.dirname(f.receipt),'active-update.json'),plan=JSON.parse(fs.readFileSync(file)).plannedReceipt;
  assert.ok(plan);assert.equal(fs.existsSync(f.pending),false);await f.run('apply_update');
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).plannedReceipt,plan);await f.run('commit_update');assert.equal(f.financial(),finance);
});
test('Windows path letter casing does not reject a real enabled package as a junction',{skip:process.platform!=='win32'},async t=>{
  const f=fixture(t);await f.installOld();
  const changes={update:{...f.request('prepare_update').update,fromModRoot:f.old.toLowerCase()}};
  await f.run('prepare_update',changes);await f.run('apply_update',changes);await f.run('commit_update',changes);
  assert.deepEqual(f.native(),f.newBytes);
});
