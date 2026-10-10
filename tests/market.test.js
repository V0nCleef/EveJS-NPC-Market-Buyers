"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createStore}=require('../lib/store'),{DEFAULTS}=require('../lib/config'),{evaluate}=require('../lib/policy');
const {createEngine}=require('../lib/engine'),{prepareMarketSource}=require('../lib/marketAdapter'),{createNativeBridge,createGate}=require('../lib/settlement');
const root=path.resolve(process.env.EVEJS_TEST_ROOT||path.join(__dirname,'../../EveJS-v0.12.9'));
const Database=require(path.join(root,'server/node_modules/better-sqlite3'));
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'npc-market-test-'));const filename=path.join(dir,'mod.sqlite');
  let store=createStore(filename,{Database});t.after(()=>{try{store.close();}catch(_){}fs.rmSync(dir,{recursive:true,force:true});});
  return {filename,get store(){return store;},reopen(){store.close();store=createStore(filename,{Database});return store;}};}
const order=(id=1,quantity=100)=>({orderID:String(id),sellerID:140000002,ownerID:140000002,typeID:34,stationID:60003760,price:10,quantity,source:'player',isCorp:false,accountKey:null});
const quote={typeID:34,referencePrice:10,dailyVolume:1000000,orders:10,confidence:'high',updatedAt:0};
function engineEnv(f,extra={}){let clock=0,draws=0,buys=[];
  const config={...DEFAULTS,enabled:true,randomBatch:false,intervalSeconds:900,cycleBudgetISK:25000000,dailyBudgetISK:250000000,sellerDailyBudgetISK:50000000};
  const adapter={listOrders:async()=>[order()],recover:async()=>{},buy:async(o,q,k)=>{buys.push({o,q,k});return {state:'settled',quantity:q,grossISK:o.price*q};},...extra.adapter};
  const options={adapter,quotes:{get:async()=>({...quote,updatedAt:clock})},store:f.store,getConfig:()=>config,evaluate,
    clock:()=>clock,random:()=>{draws++;return 0;},log:{error(){}},...extra};
  return {options,config,adapter,buys,get draws(){return draws;},setTime(x){clock=x;}};}

test('guarded source transform parses current incoming source and refuses changed owned seam',()=>{
  const source=fs.readFileSync(path.join(root,'server/src/services/market/marketProxyService.js'),'utf8');
  const patched=prepareMarketSource('// another mod contribution\n'+source);
  new vm.Script(patched);assert.ok(patched.includes('// another mod contribution'));
  assert.ok(patched.includes('expected: saga.npcMarketExpected'));
  assert.throws(()=>prepareMarketSource(patched),/already installed/);
  assert.throws(()=>prepareMarketSource(source.replace('async function executePlayerSellFillSagaUnlocked(','async function changed(')),/seam missing/);
});
test('scheduler and Limited allowance lookup preserve actual station and quantity for local fallback',async t=>{
 const f=fixture(t),env=engineEnv(f),seen=[];
 env.options.quotes={get:async(typeID,config,context)=>{seen.push({kind:'get',typeID,context});return {...quote,updatedAt:900000};},
  peek:(typeID,config,context)=>{seen.push({kind:'peek',typeID,context});return quote;}};
 const engine=createEngine(env.options);await engine.runCycle();env.setTime(900000);await engine.runCycle();
 env.config.ironMode=false;engine.previewAllowance(order());
 assert.deepEqual(seen.map(x=>x.kind),['get','peek']);
 assert.ok(seen.every(x=>x.typeID===34&&x.context.stationID===60003760&&x.context.quantity===100));
 await engine.stop();
});
test('schedule persists; splitting/restarting/duplicate cycle cannot reroll or exceed one shared batch',async t=>{
  const f=fixture(t),env=engineEnv(f);env.adapter.listOrders=async()=>[order(1,50),order(2,50)];
  let engine=createEngine(env.options);await engine.runCycle();assert.equal(env.draws,0);
  env.setTime(900000);await engine.runCycle();assert.equal(env.draws,1);assert.equal(env.buys.length,1);assert.equal(env.buys[0].q,10);
  await engine.runCycle();assert.equal(env.draws,1);
  await engine.stop();f.reopen();engine=createEngine({...env.options,store:f.store});
  await engine.runCycle();assert.equal(env.draws,1);assert.equal(env.buys.length,1);
  assert.equal(engine.status().spentTodayISK,100);
});
test('seller spending and type demand are shared across orders and cycles',async t=>{
  const f=fixture(t),env=engineEnv(f);env.config.ironMode=false;env.config.sellerDailyBudgetISK=150;env.config.cycleBudgetISK=1000;
  const engine=createEngine(env.options);await engine.runCycle();env.setTime(900000);await engine.runCycle();
  env.setTime(1800000);await engine.runCycle();env.setTime(2700000);await engine.runCycle();
  assert.deepEqual(env.buys.map(x=>x.q),[10,5]);assert.equal(engine.status().spentTodayISK,150);
  assert.equal(engine.previewAllowance({sellerID:order().sellerID,typeID:34,price:10}).availableISK,0);
});
test('iron mode buys one rare expensive item despite exhausted optional caps, with the same preview',async t=>{
  const f=fixture(t),env=engineEnv(f),rare={...order(7,1),price:1000000000};
  Object.assign(env.config,{dailyBudgetISK:0,sellerDailyBudgetISK:0,cycleBudgetISK:0});
  const cached=()=>({...quote,referencePrice:1000000000,dailyVolume:0,updatedAt:900000});
  env.options.quotes={get:async()=>cached(),peek:cached};env.adapter.listOrders=async()=>[rare];
  const engine=createEngine(env.options);await engine.runCycle();env.setTime(900000);
  const allowance=engine.previewAllowance(rare);assert.equal(allowance.unlimited,true);
  assert.equal(allowance.remainingDemand,null);
  assert.equal(evaluate({price:rare.price,quantity:1,quote:cached(),config:env.config,now:900000,...allowance}).chancePercent,35);
  await engine.runCycle();assert.equal(env.buys.length,1);assert.equal(env.buys[0].q,1);
  assert.equal(engine.status().spentTodayISK,1000000000);
  rare.price=2000000000;env.setTime(1800000);await engine.runCycle();assert.equal(env.buys.length,1);
});
test('removed order-count option migrates once without resetting the schedule or other saved choices',async t=>{
  const f=fixture(t),config={...DEFAULTS,offlinePurchases:true,maxQuoteAgeSeconds:3603,minimumOrders:17};
  const env=engineEnv(f),engine=createEngine(env.options);await engine.runCycle();await engine.stop();
  f.store.db.prepare('UPDATE nm_meta SET value=? WHERE key=?').run(JSON.stringify(config),'config');
  const schedule=f.store.db.prepare('SELECT * FROM nm_engine_meta ORDER BY key').all(),revision=f.store.getRevision();
  f.reopen();const {minimumOrders,...expected}=config;
  assert.deepEqual(f.store.getConfig(),expected);assert.equal(f.store.getRevision(),revision+1);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM nm_engine_meta ORDER BY key').all(),schedule);
  assert.equal(Object.hasOwn(JSON.parse(f.store.db.prepare("SELECT value FROM nm_meta WHERE key='config'").get().value),'minimumOrders'),false);
  f.reopen();assert.equal(f.store.getRevision(),revision+1);
});
test('existing policy defaults to TQ once and selected EVE average persists without resetting schedule',async t=>{
  const f=fixture(t),legacy={...DEFAULTS,offlinePurchases:true,maxQuoteAgeSeconds:3603};delete legacy.useEveAveragePrices;
  const env=engineEnv(f),engine=createEngine(env.options);await engine.runCycle();await engine.stop();
  f.store.db.prepare('UPDATE nm_meta SET value=? WHERE key=?').run(JSON.stringify(legacy),'config');
  const schedule=f.store.db.prepare('SELECT * FROM nm_engine_meta ORDER BY key').all(),revision=f.store.getRevision();
  f.reopen();assert.deepEqual(f.store.getConfig(),{...legacy,useEveAveragePrices:false});assert.equal(f.store.getRevision(),revision+1);
  f.store.saveConfig({...f.store.getConfig(),useEveAveragePrices:true},revision+1);f.reopen();
  assert.equal(f.store.getConfig().useEveAveragePrices,true);assert.equal(f.store.getRevision(),revision+2);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM nm_engine_meta ORDER BY key').all(),schedule);
});

test('legacy saved policy migrates once to Iron mode and fixed cadence without losing custom pricing',async t=>{
  const f=fixture(t),legacy={...DEFAULTS,chanceAtReference:42,intervalSeconds:600,maxPricePercent:115,warnAbovePercent:105};
  const oldEnv=engineEnv(f),oldEngine=createEngine(oldEnv.options);
  await oldEngine.runCycle();
  f.store.db.prepare("UPDATE nm_engine_meta SET value='600000' WHERE key='nextDueAt'").run();
  await oldEngine.stop();
  delete legacy.ironMode;
  f.store.db.prepare('UPDATE nm_meta SET value=? WHERE key=?').run(JSON.stringify(legacy),'config');
  f.store.db.prepare('UPDATE nm_meta SET value=? WHERE key=?').run('12','revision');
  f.reopen();assert.deepEqual(f.store.getConfig(),{...legacy,ironMode:true,intervalSeconds:900});assert.equal(f.store.getRevision(),13);
  assert.equal(JSON.parse(f.store.db.prepare("SELECT value FROM nm_meta WHERE key='config'").get().value).ironMode,true);
  f.store.saveConfig({...f.store.getConfig(),ironMode:false},13);f.reopen();
  assert.equal(f.store.getConfig().ironMode,false);assert.equal(f.store.getRevision(),14);
  const env=engineEnv(f),engine=createEngine({...env.options,getConfig:()=>f.store.getConfig()});
  await engine.runCycle();assert.equal(engine.status().nextDueAt,900000);
  env.setTime(600000);await engine.runCycle();assert.equal(env.buys.length,0);
  env.setTime(900000);await engine.runCycle();assert.equal(env.buys.length,1);
  assert.equal(engine.status().nextDueAt,1800000);
});
test('ambiguous purchase keeps reservation and resumes the same operation without a new draw',async t=>{
  const f=fixture(t),env=engineEnv(f);let attempts=0,key;
  env.adapter.buy=async(o,q,k)=>{attempts++;if(key)assert.equal(k,key);key=k;
    if(attempts===1)throw Error('RPC reply lost');return {state:'settled',quantity:q,grossISK:q*o.price};};
  const engine=createEngine(env.options);await engine.runCycle();env.setTime(900000);
  await assert.rejects(engine.runCycle(),/reply lost/);assert.equal(engine.status().pending,1);assert.equal(env.draws,1);
  await engine.runCycle();assert.equal(engine.status().pending,0);assert.equal(env.draws,1);assert.equal(attempts,2);
});
test('random batch and chance persist across an ambiguous commit and process restart',async t=>{
  const f=fixture(t),env=engineEnv(f);env.config.randomBatch=true;
  env.adapter.listOrders=async()=>[order(1,1000000)];
  const values=[0,2/3];let calls=0,attempts=0,firstKey;
  env.options.random=()=>{calls++;assert.ok(values.length,'No reroll allowed');return values.shift();};
  env.adapter.buy=async(o,q,key)=>{assert.equal(q,10000);if(firstKey)assert.equal(key,firstKey);firstKey=key;
    if(++attempts===1)throw Error('lost random batch acknowledgement');
    return {state:'settled',quantity:q,grossISK:q*o.price};};
  let engine=createEngine(env.options);await engine.runCycle();env.setTime(900000);
  await assert.rejects(engine.runCycle(),/lost random batch/);
  const draw=f.store.db.prepare('SELECT * FROM nm_draws').get();assert.equal(draw.batch_draw,2/3);
  await engine.stop();f.reopen();engine=createEngine({...env.options,store:f.store});
  await engine.runCycle();assert.equal(calls,2);assert.equal(attempts,2);assert.equal(engine.status().pending,0);
});
test('existing fixed-quantity draw upgrades without a new batch roll',async t=>{
  const f=fixture(t),env=engineEnv(f);env.config.randomBatch=true;
  f.store.db.exec('CREATE TABLE nm_draws(cycle_id TEXT, group_key TEXT, draw REAL, chance REAL, PRIMARY KEY(cycle_id,group_key))');
  const engine=createEngine(env.options);await engine.runCycle();
  f.store.db.prepare('INSERT INTO nm_draws(cycle_id,group_key,draw,chance) VALUES (?,?,?,?)').run('900000','140000002:34:60003760',0,35);
  env.setTime(900000);await engine.runCycle();assert.equal(env.draws,0);assert.equal(env.buys[0].q,10);
});
test('0.1.1 policy gains persisted random batch settings once without changing existing policy',t=>{
  const f=fixture(t),legacy={...DEFAULTS,ironMode:true,chanceAtReference:42,batchPercent:0.01};
  delete legacy.randomBatch;delete legacy.minimumBatchPercent;
  f.store.db.prepare('UPDATE nm_meta SET value=? WHERE key=?').run(JSON.stringify(legacy),'config');
  const revision=f.store.getRevision();f.reopen();
  assert.equal(f.store.getRevision(),revision+1);assert.equal(f.store.getConfig().randomBatch,true);
  assert.equal(f.store.getConfig().minimumBatchPercent,0.01);assert.equal(f.store.getConfig().chanceAtReference,42);
  f.store.saveConfig({...f.store.getConfig(),randomBatch:false},f.store.getRevision());f.reopen();
  assert.equal(f.store.getConfig().randomBatch,false);assert.equal(f.store.getRevision(),revision+2);
});
test('pausing stops new purchases while already authorized ambiguous work still recovers',async t=>{
  const f=fixture(t),env=engineEnv(f);let calls=0;
  env.adapter.buy=async(o,q)=>{if(++calls===1)throw Error('lost ack');return {state:'settled',quantity:q,grossISK:q*o.price};};
  const engine=createEngine(env.options);await engine.runCycle();env.setTime(900000);await assert.rejects(engine.runCycle());
  env.config.enabled=false;await engine.runCycle();assert.equal(calls,2);assert.equal(engine.status().pending,0);
  env.setTime(1800000);await engine.runCycle();assert.equal(calls,2);assert.equal(env.draws,1);
});
test('stale reference prevents purchase; a persisted draw does not improve after repricing',async t=>{
  const f=fixture(t),env=engineEnv(f);env.options.quotes={get:async()=>({...quote,updatedAt:-10000000})};
  const engine=createEngine(env.options);await engine.runCycle();env.setTime(900000);await engine.runCycle();assert.equal(env.buys.length,0);
});

test('offline purchases default off skips missed checks after one overdue pass',async t=>{
  const f=fixture(t),env=engineEnv(f),engine=createEngine(env.options);
  await engine.runCycle();env.setTime(3600000);await engine.runCycle();await engine.runCycle();
  assert.equal(env.buys.length,1);assert.equal(engine.status().nextDueAt,4500000);
  assert.equal(engine.status().catchingUp,false);
});

test('offline catch-up replays one durable random batch per pass across restart, then stops',async t=>{
  const f=fixture(t),env=engineEnv(f);Object.assign(env.config,{offlinePurchases:true,randomBatch:true});
  let remaining=100;
  env.adapter.listOrders=async()=>[{...order(1,remaining),issuedAt:new Date(0).toISOString()}];
  env.adapter.buy=async(o,q,k)=>{remaining-=q;env.buys.push({q,k});return {state:'settled',quantity:q,grossISK:o.price*q};};
  let engine=createEngine(env.options);await engine.runCycle();env.setTime(3600000);
  assert.equal(engine.status().catchingUp,true);
  await engine.runCycle();assert.equal(env.buys.length,1);assert.equal(engine.status().nextDueAt,1800000);
  await engine.stop();f.reopen();engine=createEngine({...env.options,store:f.store});
  await engine.runCycle();await engine.runCycle();await engine.runCycle();await engine.runCycle();
  assert.equal(env.buys.length,4);assert.equal(remaining,96);assert.equal(env.draws,8);
  assert.equal(new Set(env.buys.map(b=>b.k)).size,4);assert.equal(engine.status().catchingUp,false);
  assert.equal(engine.status().nextDueAt,4500000);
});

test('catch-up starts at listing time, skips expired orders, and always uses current fair quotes',async t=>{
  const f=fixture(t),env=engineEnv(f);env.config.offlinePurchases=true;
  env.adapter.listOrders=async()=>[
    {...order(1),issuedAt:new Date(1800001).toISOString()},
    {...order(2),typeID:35,expiresAt:new Date(3000000).toISOString()},
    {...order(3),typeID:36,price:1000}];
  const engine=createEngine(env.options);await engine.runCycle();env.setTime(3600000);
  await engine.runCycle();assert.equal(env.buys.length,0);assert.equal(engine.status().nextDueAt,2700000);
  await engine.runCycle();await engine.runCycle();
  assert.deepEqual(env.buys.map(b=>[b.o.orderID,b.k.split(':')[1]]),[['1','2700000'],['1','3600000']]);
  assert.equal(engine.status().catchingUp,false);
  env.setTime(4500000);env.options.quotes.get=async()=>({...quote,updatedAt:0});
  await engine.runCycle();assert.equal(env.buys.length,2);
});

test('saved catch-up toggle migrates once, persists, and resets the clock on pause or mode changes',async t=>{
  const f=fixture(t),legacy={...DEFAULTS,chanceAtReference:42};delete legacy.offlinePurchases;
  f.store.db.prepare("UPDATE nm_meta SET value=? WHERE key='config'").run(JSON.stringify(legacy));
  const revision=f.store.getRevision();f.reopen();
  assert.equal(f.store.getConfig().offlinePurchases,false);assert.equal(f.store.getRevision(),revision+1);
  const env=engineEnv(f),options={...env.options,getConfig:()=>f.store.getConfig()};let engine=createEngine(options);
  await engine.runCycle();env.setTime(3600000);
  f.store.saveConfig({...f.store.getConfig(),offlinePurchases:true},f.store.getRevision());
  await engine.runCycle();assert.equal(env.buys.length,0);assert.equal(engine.status().nextDueAt,4500000);
  await engine.stop();f.reopen();engine=createEngine({...options,store:f.store});
  assert.equal(f.store.getConfig().offlinePurchases,true);assert.equal(f.store.getConfig().chanceAtReference,42);
  f.store.saveConfig({...f.store.getConfig(),enabled:false},f.store.getRevision());
  env.setTime(7200000);await engine.runCycle();
  f.store.saveConfig({...f.store.getConfig(),enabled:true},f.store.getRevision());
  env.setTime(10800000);await engine.runCycle();assert.equal(env.buys.length,0);
  assert.equal(engine.status().nextDueAt,11700000);
  f.store.saveConfig({...f.store.getConfig(),offlinePurchases:false},f.store.getRevision());
  f.reopen();assert.equal(f.store.getConfig().offlinePurchases,false);
});

test('offline recovery completes the same payment, retains backlog and resolves the activity status',async t=>{
  const f=fixture(t),env=engineEnv(f);env.config.offlinePurchases=true;
  let calls=0;env.adapter.buy=async(o,q,k)=>{if(++calls===1)throw Error('lost acknowledgement');
    return {state:'settled',quantity:q,grossISK:o.price*q,taxISK:8};};
  let engine=createEngine(env.options);await engine.runCycle();env.setTime(3600000);
  await assert.rejects(engine.runCycle(),/lost acknowledgement/);const savedDraws=env.draws;
  const intendedTime=f.store.db.prepare('SELECT activity_at FROM nm_operations').get().activity_at;
  assert.ok(intendedTime>=900000&&intendedTime<1800000);
  const {installService}=require('../lib/service');class Service{}
  installService(Service,{store:f.store,quotes:env.options.quotes,engine,adapter:env.adapter,hasStaffAccountRole:()=>true});
  const events=async()=>JSON.parse(await new Service().Handle_NpcMarketActivity([],{charid:order().sellerID})).activity;
  assert.equal((await events()).find(e=>e.kind==='recovery').resolution,'pending');
  await engine.stop();f.reopen();engine=createEngine({...env.options,store:f.store});await engine.runCycle();
  assert.equal(env.draws,savedDraws);assert.equal(calls,2);assert.equal(engine.status().nextDueAt,1800000);
  class ReopenedService{}installService(ReopenedService,{store:f.store,quotes:env.options.quotes,engine,adapter:env.adapter,hasStaffAccountRole:()=>true});
  const history=JSON.parse(await new ReopenedService().Handle_NpcMarketActivity([],{charid:order().sellerID})).activity;
  assert.equal(history.find(e=>e.kind==='recovery').resolution,'settled');
  assert.equal(history.filter(e=>e.kind==='purchase').length,1);
  const purchase=history.find(e=>e.kind==='purchase');
  assert.equal(purchase.timestamp,intendedTime);assert.equal(purchase.settledAt,3600000);assert.equal(purchase.offlinePurchase,true);
  env.config.enabled=false;env.setTime(7200000);await engine.runCycle();assert.equal(calls,2);
  env.config.enabled=true;await engine.runCycle();assert.equal(calls,2);
});
test('mutation gate serializes independent operations and permits nested settlement',async()=>{
  const gate=createGate(1000),trace=[];
  const inner=gate.wrap(async()=>{trace.push('nested');});
  const first=gate.wrap(async()=>{trace.push('first');await new Promise(r=>setTimeout(r,15));await inner();trace.push('end');});
  const second=gate.wrap(async()=>{trace.push('second');});
  await Promise.all([first(),second()]);assert.deepEqual(trace,['first','nested','end','second']);
});
test('a delayed callback cannot reuse an expired reentrancy lease',async()=>{
  const gate=createGate(1000),trace=[];let delayed;
  const callback=gate.wrap(async()=>{trace.push('callback');});
  await gate.wrap(async()=>{delayed=new Promise(resolve=>setTimeout(()=>callback().then(resolve),5));})();
  await gate.wrap(async()=>{trace.push('new owner');await new Promise(r=>setTimeout(r,20));trace.push('owner done');})();
  await delayed;assert.deepEqual(trace,['new owner','owner done','callback']);
});

function nativeFixture(f,{corp=false}={}) {
  const chars=new Map([[140000002,{accountId:1,characterName:'Player'}]]),balances=new Map(),commands=new Map();
  let current={order_id:'1',owner_id:corp?98000001:140000002,is_corp:corp,source:'player',state:'open',
    row:{order_id:'1',type_id:34,station_id:60003760,region_id:10000002,price:10,vol_entered:100,vol_remaining:100,bid:false}};
  let escrow={orderId:'1',ownerId:140000002,isCorp:corp,walletOwnerId:corp?98000001:140000002,accountKey:1000,remainingQuantity:100};
  const history=[],goods=[],funding=[];let bridge,failHistory=false,failAfterFunding=false;
  const native={
    database:{read:()=>({success:true,data:Object.fromEntries(chars)}),write:(table,key,value)=>{chars.set(Number(key.slice(1)),value);balances.set(Number(key.slice(1)),value.balance);return {success:true};},flushTableSync:()=>({success:true})},
    marketDaemonClient:{call:async()=>({capabilities:['conditional-fill-v1']})},
    authority:{isWalletAuthorityProcessEnabled:()=>true},characters:{peekCharacterRecord:id=>chars.get(id)},
    allocator:{reserveCharacterID:()=>140000003},getStationRecord:()=>({regionID:10000002}),getStationSolarSystemID:()=>30000142,getStationConstellationID:()=>20000020,
    listEscrowRecords:()=>escrow?[escrow]:[],getEscrowRecord:()=>escrow,fetchOrderById:async()=>current,getOwnerOrderResponseOrder:x=>x.row,
    wallet:{JOURNAL_ENTRY_TYPE:{GM_CASH_TRANSFER:3},getCharacterWallet:id=>({balance:balances.get(id)||0}),
      adjustCharacterBalanceAsync:async(id,amount,options,meta)=>{if(!commands.has(meta.commandID)){commands.set(meta.commandID,amount);balances.set(id,(balances.get(id)||0)+amount);funding.push(amount);}return {success:true};},
      appendCharacterMarketTransactionAsync:async(id,entry,meta)=>{if(failHistory){failHistory=false;throw Error('history RPC lost');}if(!commands.has(meta.commandID)){commands.set(meta.commandID,1);history.push({id,entry,meta});}return {success:true};}},
    corpWallet:{appendCorporationMarketTransactionAsync:async(id,accountKey,entry,meta)=>{if(!commands.has(meta.commandID)){commands.set(meta.commandID,1);history.push({id,accountKey,entry,meta});}return {success:true};}},
    buildCharacterMarketContext:()=>({}),computeSalesTaxAmount:(_c,value)=>value*.01,getMarketCounterpartyOwnerID:()=>1000009,notifyOwnOrdersChanged:()=>{},
    buildPlayerSellFillSaga:input=>{if(failAfterFunding){failAfterFunding=false;throw Error('after funding crash');}const {escrowRecord,sellOrder,...data}=input;return {...data,
      orderID:'1',buyerWalletID:input.buyerCharacterID,sellerWalletID:input.sellerWalletID,itemLegs:[],attempt:1,
      createdAt:new Date(0).toISOString()};},
    persistPlayerSellFillSaga:(_escrow,saga)=>{escrow.pendingFill=saga;},
    executePlayerSellFillSaga:async(_escrow,saga)=>{
      if(!saga.fillResponse){assert.deepEqual(saga.npcMarketExpected,{owner_id:current.owner_id,is_corp:corp,type_id:34,station_id:60003760,price:10,vol_remaining:100,source:'player'});
        balances.set(saga.buyerCharacterID,balances.get(saga.buyerCharacterID)-saga.grossCost);
        goods.push({ownerID:saga.buyerCharacterID,quantity:saga.tradedQuantity,stationID:60003760});
        current.row.vol_remaining-=saga.tradedQuantity;saga.fillResponse={vol_remaining:current.row.vol_remaining};}
      bridge.completed(saga,saga.fillResponse);escrow.pendingFill=null;escrow.remainingQuantity=current.row.vol_remaining;
      return {compensated:false,fillResponse:saga.fillResponse};}
  };
  bridge=createNativeBridge(native);bridge.attach(f.store);
  return {bridge,chars,history,goods,funding,balances,get current(){return current;},get escrow(){return escrow;},
    loseHistory(){failHistory=true;},crashAfterFunding(){failAfterFunding=true;}};
}
test('native adapter creates zero-funded institution only on purchase, keeps goods and replays receipts/history',async t=>{
  const f=fixture(t),n=nativeFixture(f);assert.equal(n.chars.size,1);
  const orders=await n.bridge.listOrders();assert.equal(orders.length,1);
  assert.equal(orders[0].originalQuantity,100);
  const key='npc-market:900000:140000002:34:60003760';n.loseHistory();
  await assert.rejects(n.bridge.buy(orders[0],10,key),/history RPC lost/);
  const result=await n.bridge.buy(orders[0],10,key);assert.equal(result.state,'settled');
  assert.equal(n.goods.length,1);assert.deepEqual(n.funding,[100]);assert.equal(n.history.length,2);
  const institution=n.chars.get(result.buyerID);assert.equal(institution.accountId,null);assert.equal(institution.suppressSkillBootstrap,true);assert.equal(institution.plexBalance,0);
  await n.bridge.buy(orders[0],10,key);assert.equal(n.goods.length,1);assert.equal(n.history.length,2);
  const remaining=(await n.bridge.listOrders())[0];assert.equal(remaining.quantity,90);assert.equal(remaining.originalQuantity,100);
  assert.equal(f.store.db.prepare('SELECT saga_json FROM nm_native_ops WHERE operation_key=?').get(key).saga_json,null);
  await assert.rejects(n.bridge.buy({...orders[0],price:11},10,key),/reused/);
});
test('funding receipt survives failure before saga creation and corporation history uses stable command IDs',async t=>{
  const f=fixture(t),n=nativeFixture(f,{corp:true}),orders=await n.bridge.listOrders();
  const key='npc-market:900000:corp-test';n.crashAfterFunding();
  await assert.rejects(n.bridge.buy(orders[0],10,key),/after funding crash/);
  const receipt=await n.bridge.buy(orders[0],10,key);assert.equal(receipt.state,'settled');
  assert.deepEqual(n.funding,[100]);assert.equal(n.history.filter(x=>x.accountKey===1000).length,1);
  assert.equal(n.bridge.walletMetadata({idempotencyKey:key+':wallet:seller-credit'}).commandID,key+':wallet:seller-credit');
  assert.deepEqual(n.bridge.walletMetadata({idempotencyKey:'normal-market'}),{});
});
test('changed exact order is rejected before funding and institutional orders cannot become eligible',async t=>{
  const f=fixture(t),n=nativeFixture(f),orders=await n.bridge.listOrders();n.current.row.price=11;
  await assert.rejects(n.bridge.buy(orders[0],10,'npc-market:changed'),/changed/);assert.equal(n.funding.length,0);
  n.chars.get(140000002).accountId=0;assert.equal((await n.bridge.listOrders()).length,0);
});
test('iron-mode institutional funding exceeds the optional daily cap and remains receipted once',async t=>{
  const f=fixture(t),n=nativeFixture(f),buyerID=n.bridge._testing.identity();
  await n.bridge._testing.fund(buyerID,'npc-market:iron-funding',1000000000);
  await n.bridge._testing.fund(buyerID,'npc-market:iron-funding',1000000000);
  assert.deepEqual(n.funding,[1000000000]);
  f.store.saveConfig({...f.store.getConfig(),ironMode:false},f.store.getRevision());
  n.balances.set(buyerID,0);
  await assert.rejects(n.bridge._testing.fund(buyerID,'npc-market:limited-funding',1000000000),/funding cap/);
  assert.deepEqual(n.funding,[1000000000]);
});
test('an evicted authority receipt stops an old intent instead of paying it again',t=>{
  const f=fixture(t),n=nativeFixture(f);const key='npc-market:eviction:wallet:seller-credit';
  n.bridge.walletMetadata({idempotencyKey:key},140000002,false);
  // Native fixture initially has no receipt reader; this new bridge shares the
  // mod intents and models an owner's durable receipt list reaching its cap.
  const b=createNativeBridge({walletReceipts:{findOwnerReceipt:()=>null,isOwnerReceiptListSaturated:()=>true}});b.attach(f.store);
  assert.throws(()=>b.walletMetadata({idempotencyKey:key},140000002,false),/evicted/);
});
