"use strict";
// Real server modules + real wallet authority child + real Rust daemon.
// All writable paths and ports are generated below. This script never imports
// a GameStore until its environment points at the new candidate fixture.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict'),
  {spawn}=require('node:child_process'),Module=require('node:module');
const candidate=path.resolve(__dirname,'..'),root=path.resolve(process.env.EVEJS_TEST_ROOT||path.join(candidate,'../EveJS-v0.12.9'));
const Database=require(path.join(root,'server/node_modules/better-sqlite3'));
const sellerID=140000101,stationID=60003760;
function staticFixture(directory){
  const selected={itemTypes:['types',row=>[34,606,670].includes(row.typeID)],
    shipTypes:['ships',row=>[606,670].includes(row.typeID)],
    solarSystems:['solarSystems',row=>row.solarSystemID===30000142],
    stations:['stations',row=>row.stationID===stationID],
    characterCreationRaces:['races',()=>true],characterCreationBloodlines:['bloodlines',()=>true],
    characterCreationSchools:['schools',()=>true],skillTypes:['skills',row=>[3443,3446,16594,16595,16622,3444,3445].includes(row.typeID)],
    typeDogma:['types',()=>false]};
  for(const [table,[key,filter]]of Object.entries(selected)){
    const input=path.join(root,'_local/gameStore/data',table,'data.json');
    const original=fs.existsSync(input)?JSON.parse(fs.readFileSync(input,'utf8')):{};
    const values=Array.isArray(original[key])?original[key]:Object.values(original[key]||{});
    fs.mkdirSync(path.join(directory,table),{recursive:true});
    fs.writeFileSync(path.join(directory,table,'data.json'),JSON.stringify({source:{provider:'isolated selected static fixture'},[key]:values.filter(filter)}));
  }
}
function marketFixture(filename){
  const source=fs.readFileSync(path.join(candidate,'native/market-server/crates/market-common/src/lib.rs'),'utf8');
  const schema=source.split('pub const SCHEMA_SQL: &str = r#"')[1].split('"#;')[0];
  const db=new Database(filename);db.exec(schema);
  db.prepare('INSERT INTO regions VALUES (?,?)').run(10000002,'The Forge');
  db.prepare('INSERT INTO solar_systems VALUES (?,?,?,?,?)').run(30000142,10000002,20000020,'Jita',0.9);
  db.prepare('INSERT INTO stations VALUES (?,?,?,?,?,?)').run(stationID,30000142,20000020,10000002,'Jita fixture',0.9);
  db.prepare('INSERT INTO market_types VALUES (?,?,?,?,?,?,?,?,?,?)').run(34,18,4,185,'Tritanium','Mineral',10,0.01,1,1);
  const manifest={schema_version:1,generated_at:new Date().toISOString(),static_data_dir:'isolated-fixture',database_path:filename,
    region_count:1,solar_system_count:1,station_count:1,market_type_count:1,seed_row_count:0,default_quantity_per_station_type:0,
    seed_buy_orders_enabled:false,history_days_seeded:0,seed_markup_percent:0,station_jitter_percent:0,region_jitter_percent:0,
    selection_mode:'isolated-test',selection_label:'NPC Market Buyers isolated integration',selected_solar_system_ids:[30000142],selected_solar_system_names:['Jita']};
  db.prepare('INSERT INTO manifest VALUES (?,?)').run('manifest_json',JSON.stringify(manifest));db.close();
}
async function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}
async function waitPort(port,child){let lastError;for(let count=0;count<40;count++){if(child.exitCode!==null)throw Error('Isolated daemon exited before readiness');
  const ready=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.setTimeout(1000,()=>{lastError='socket timeout';socket.destroy();resolve(false);});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',error=>{lastError=error.code;resolve(false);});});
  if(ready)return;await new Promise(r=>setTimeout(r,250));}throw Error('Isolated daemon readiness timeout: '+lastError);}
async function runChild(phase,directory,rpcPort){return new Promise((resolve,reject)=>{
  const output=fs.createWriteStream(path.join(directory,phase+'.log'));
  const child=spawn(process.execPath,[__filename,phase,directory],{cwd:directory,windowsHide:true,
    env:{...process.env,EVEJS_DATA_ROOT:path.join(directory,'runtime'),EVEJS_GAMESTORE_DATA_DIR:path.join(directory,'store/data'),
      EVEJS_GAMESTORE_OWNER_ROLE:'world',EVEJS_MARKET_DAEMON_HOST:'127.0.0.1',EVEJS_MARKET_DAEMON_PORT:String(rpcPort),
      EVEJS_GAMESTORE_PERSISTENCE_WORKER:'0',NPC_MARKET_INTEGRATION_FIXTURE:directory},stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(output);child.stderr.pipe(output);
  const timer=setTimeout(()=>{child.kill();reject(Error('Isolated integration phase timeout'));},60000);
  child.once('error',error=>{clearTimeout(timer);output.end();reject(error);});
  child.once('exit',code=>{clearTimeout(timer);output.end();if(code===0)resolve();else reject(Error(`Integration ${phase} exited ${code}; see ${phase}.log`));});
});}
async function parent(){
  const binary=process.argv[2]||path.join(candidate,'native/market-server/target/release/market-server.exe');
  if(!fs.existsSync(binary))throw Error('Built candidate daemon required: '+binary);
  const directory=fs.mkdtempSync(path.join(candidate,'evidence/market-native-'));
  fs.mkdirSync(path.join(directory,'store/data'),{recursive:true});staticFixture(path.join(directory,'store/data'));
  marketFixture(path.join(directory,'market.sqlite'));
  const httpPort=await freePort(),rpcPort=await freePort();
  const config=path.join(directory,'market.toml');fs.writeFileSync(config,`[network]\nport=${httpPort}\n[rpc]\nenabled=true\nport=${rpcPort}\n[storage]\ndatabase_path=${JSON.stringify(path.join(directory,'market.sqlite').replace(/\\/g,'/'))}\n[logging]\nlog_level="warn"\n`);
  let daemon;
  async function start(){const output=fs.createWriteStream(path.join(directory,'daemon.log'),{flags:'a'});
    daemon=spawn(binary,['--config',config],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe']});daemon.stdout.pipe(output);daemon.stderr.pipe(output);daemon.once('exit',()=>output.end());await waitPort(rpcPort,daemon);}
  async function stop(){if(daemon&&daemon.exitCode===null){await new Promise(resolve=>{daemon.once('exit',resolve);daemon.kill();});}}
  try{await start();await runChild('purchase',directory,rpcPort);await stop();await start();await runChild('restart',directory,rpcPort);
    const result=JSON.parse(fs.readFileSync(path.join(directory,'result.json'),'utf8'));
    console.log(JSON.stringify({success:true,directory,httpPort,rpcPort,...result},null,2));
  }finally{await stop();}
}
async function phase(name,directory){
  assert.equal(process.env.NPC_MARKET_INTEGRATION_FIXTURE,directory);
  assert.ok(path.resolve(process.env.EVEJS_GAMESTORE_DATA_DIR).startsWith(path.resolve(directory)+path.sep));
  const {prepareMarketSource,createMarketAdapter}=require('../lib/marketAdapter');
  const target=path.join(root,'server/src/services/market/marketProxyService.js'),originalCompile=Module.prototype._compile;
  Module.prototype._compile=function(content,filename){return originalCompile.call(this,path.resolve(filename)===target?prepareMarketSource(content):content,filename);};
  const db=require(path.join(root,'server/src/gameStore'));
  const wallet=require(path.join(root,'server/src/services/account/walletState'));
  let lostWalletKey=null,walletInjected=false;
  const originalWalletAdjust=wallet.adjustCharacterBalanceAsync;
  wallet.adjustCharacterBalanceAsync=async function(...args){const result=await originalWalletAdjust(...args);
    if(lostWalletKey&&args[2]?.idempotencyKey===lostWalletKey&&!walletInjected){walletInjected=true;
      const error=Error('Injected lost wallet acknowledgement after real commit');error.code='ORDERED_PROCESS_REQUEST_TIMEOUT';throw error;}
    return result;};
  const corpWallet=require(path.join(root,'server/src/services/corporation/corpWalletState'));
  const authority=require(path.join(root,'server/src/services/account/walletCommandAuthority'));
  const items=require(path.join(root,'server/src/services/inventory/itemStore'));
  const escrow=require(path.join(root,'server/src/services/market/marketEscrowState'));
  const {marketDaemonClient}=require(path.join(root,'server/src/services/market/marketDaemonClient'));
  const Service=require(target);
  const {createStore}=require('../lib/store'),store=createStore(path.join(directory,'mod.sqlite'),{Database});
  const adapter=createMarketAdapter(root,{store});
  try{
    if(name==='purchase'){
      const now=(BigInt(Date.now())*10000n+116444736000000000n).toString();
      const character={accountId:1,characterName:'Isolated Seller',raceID:1,bloodlineID:1,typeID:1373,corporationID:1000009,
        stationID,homeStationID:stationID,cloneStationID:stationID,solarSystemID:30000142,constellationID:20000020,regionID:10000002,
        balance:1000000000,aurBalance:0,plexBalance:0,walletJournal:[],marketTransactions:[],suppressSkillBootstrap:true,
        createDateTime:now,startDateTime:now,shipID:0,gender:1,schoolID:11,standingData:{char:[],corp:[],npc:[]}};
      assert.equal(db.write('characters',`/${sellerID}`,character).success,true);assert.equal(db.flushTableSync('characters').success,true);
      await authority.enableWalletAuthorityProcess();await adapter.ready();
      const grant=items.grantItemToCharacterStationHangar(sellerID,stationID,34,100);
      assert.equal(grant.success,true);const item=grant.data.items?grant.data.items[0]:grant.data;
      const session={characterID:sellerID,charid:sellerID,stationid:stationID,regionid:10000002,solarsystemid2:30000142,corpid:1000009,
        sendNotification(){},sendSessionChange(){}};
      const service=new Service();
      assert.equal(await service.Handle_PlaceMultiSellOrder([[{itemID:item.itemID,typeID:34,stationID,quantity:100,price:10}],false,30],session),true);
      const listed=await adapter.listOrders();assert.equal(listed.length,1);assert.equal(listed[0].quantity,100);
      const before=wallet.getCharacterWallet(sellerID).balance,key=`npc-market:integration:${listed[0].orderID}`;
      const result=await adapter.buy(listed[0],10,key);
      assert.equal(result.state,'settled');assert.equal(result.quantity,10);
      const after=wallet.getCharacterWallet(sellerID).balance;assert.equal(Math.round((after-before)*100),Math.round((100-result.taxISK)*100));
      const book=await marketDaemonClient.call('GetOrder',{order_id:listed[0].orderID});assert.equal(book.row.vol_remaining,90);
      const goods=items.listContainerItems(result.buyerID,stationID,items.ITEM_FLAGS.HANGAR).filter(i=>i.typeID===34);
      assert.equal(goods.reduce((n,i)=>n+i.stacksize,0),10);
      const history=wallet.getCharacterMarketTransactions(sellerID);assert.equal(history.length,1);
      const buyer=wallet.getCharacterWallet(result.buyerID);assert.equal(buyer.balance,0);
      const institution=db.read('characters',`/${result.buyerID}`).data;
      assert.equal(institution.accountId,null);assert.equal(institution.suppressSkillBootstrap,true);
      assert.equal(Object.keys(db.read('skills',`/${result.buyerID}`).data||{}).length,0);
      assert.equal(Object.values(db.read('items','/').data||{}).filter(i=>i.ownerID===result.buyerID&&i.typeID!==34).length,0);
      const replay=await adapter.buy(listed[0],10,key);assert.equal(replay.quantity,10);assert.equal(wallet.getCharacterWallet(sellerID).balance,after);
      assert.equal(escrow.getEscrowRecord(listed[0].orderID).remainingQuantity,90);
      const report={order:listed[0],operationKey:key,result,before,after,historyCount:history.length,
        actualGameStore:db._sqliteDbPath,goodsQuantity:10,nativePurchase:true};
      // Real corporation-wallet order using the seller's personal goods; the
      // daemon order owner is the corporation, escrow actor stays the player.
      const corporationID=98000101,corporations=require(path.join(root,'server/src/services/corporation/corporationState')),
        runtime=require(path.join(root,'server/src/services/corporation/corporationRuntimeState'));
      assert.equal(corporations.setCorporationRecord({corporationID,corporationName:'Isolated Player Corporation',
        tickerName:'NMB',ceoID:sellerID,creatorID:sellerID,isNPC:false,memberIDs:[sellerID]}).success,true);
      assert.equal(runtime.updateCorporationRuntime(corporationID,()=>({})).success,true);
      db.flushTableSync('corporations');db.flushTableSync('corporationRuntime');
      assert.equal((await corpWallet.setCorporationWalletDivisionBalanceAsync(corporationID,1000,10000000,
        {description:'Isolated test fixture funding'},{commandID:'integration:corp:initial'})).success,true);
      const corpGrant=items.grantItemToCharacterStationHangar(sellerID,stationID,34,100);
      assert.equal(corpGrant.success,true);const corpItem=corpGrant.data.items?corpGrant.data.items[0]:corpGrant.data;
      const corpSession={...session,corpid:corporationID,corprole:'18014398509481984',corpAccountKey:1000};
      assert.equal(await service.Handle_PlaceMultiSellOrder([[{itemID:corpItem.itemID,typeID:34,stationID,quantity:100,price:10}],true,30],corpSession),true);
      const corpOrder=(await adapter.listOrders()).find(order=>order.isCorp);assert.ok(corpOrder);
      const corpBefore=corpWallet.getCorporationWalletBalance(corporationID,1000),corpKey=`npc-market:integration:corp:${corpOrder.orderID}`;
      const corpResult=await adapter.buy(corpOrder,10,corpKey),corpAfter=corpWallet.getCorporationWalletBalance(corporationID,1000);
      assert.equal(Math.round((corpAfter-corpBefore)*100),Math.round((100-corpResult.taxISK)*100));
      assert.equal(corpWallet.getCorporationMarketTransactions(corporationID,1000).length,1);
      await adapter.buy(corpOrder,10,corpKey);assert.equal(corpWallet.getCorporationWalletBalance(corporationID,1000),corpAfter);
      assert.equal(corpWallet.getCorporationMarketTransactions(corporationID,1000).length,1);
      report.corporation={order:corpOrder,operationKey:corpKey,result:corpResult,before:corpBefore,after:corpAfter,historyCount:1};
      report.goodsQuantity=20;
      // Exercise the actual scheduler -> funding -> real wallet/custody/daemon
      // path for one item above every old spending cap, with zero TQ volume.
      // The price quote here is deterministic fixture data, not a live TQ claim.
      const ironGrant=items.grantItemToCharacterStationHangar(sellerID,stationID,34,1);
      assert.equal(ironGrant.success,true);const ironItem=ironGrant.data.items?ironGrant.data.items[0]:ironGrant.data;
      assert.equal(await service.Handle_PlaceMultiSellOrder([[{itemID:ironItem.itemID,typeID:34,stationID,quantity:1,price:1000000000}],false,30],session),true);
      const ironOrder=(await adapter.listOrders()).find(order=>order.price===1000000000);assert.ok(ironOrder);
      const {createEngine}=require('../lib/engine'),{evaluate}=require('../lib/policy');
      let ironTime=Date.now();
      const ironQuotes={get:async()=>({typeID:34,referencePrice:1000000000,dailyVolume:0,orders:3,confidence:'high',updatedAt:ironTime})};
      const ironEngine=createEngine({adapter:{...adapter,listOrders:async()=>[ironOrder]},quotes:ironQuotes,store,
        getConfig:()=>store.getConfig(),evaluate,clock:()=>ironTime,random:()=>0});
      const ironBefore=wallet.getCharacterWallet(sellerID).balance;
      await ironEngine.runCycle();ironTime+=900000;await ironEngine.runCycle();await ironEngine.stop();
      assert.equal(ironEngine.status().pending,0);assert.equal(ironEngine.status().spentTodayISK,1000000000);
      const ironReceipt=JSON.parse(store.db.prepare("SELECT result_json FROM nm_operations WHERE state='settled'").get().result_json);
      assert.equal(ironReceipt.quantity,1);assert.equal(ironReceipt.grossISK,1000000000);
      assert.equal(wallet.getCharacterWallet(sellerID).balance,ironBefore+ironReceipt.grossISK-ironReceipt.taxISK);
      assert.equal((await marketDaemonClient.call('GetOrder',{order_id:ironOrder.orderID})).row.vol_remaining,0);
      report.ironMode={order:ironOrder,operationKey:ironReceipt.operationKey,result:ironReceipt,before:ironBefore,
        after:wallet.getCharacterWallet(sellerID).balance,zeroTQVolume:true,realScheduler:true};
      report.historyCount=2;report.goodsQuantity+=1;
      // A nontrivial random batch uses the same real settlement path. The
      // sample is fixed only in this fixture: 1..100 units, draw .75 -> 31.
      const randomGrant=items.grantItemToCharacterStationHangar(sellerID,stationID,34,1000);
      assert.equal(randomGrant.success,true);const randomItem=randomGrant.data.items?randomGrant.data.items[0]:randomGrant.data;
      assert.equal(await service.Handle_PlaceMultiSellOrder([[{itemID:randomItem.itemID,typeID:34,stationID,quantity:1000,price:9}],false,30],session),true);
      const randomOrder=(await adapter.listOrders()).find(order=>order.price===9);assert.ok(randomOrder);
      const samples=[0,.75];ironTime+=900000;
      const randomEngine=createEngine({adapter:{...adapter,listOrders:async()=>[randomOrder]},
        quotes:{get:async()=>({typeID:34,referencePrice:9,dailyVolume:0,orders:3,confidence:'high',updatedAt:ironTime})},
        store,getConfig:()=>store.getConfig(),evaluate,clock:()=>ironTime,random:()=>{assert.ok(samples.length);return samples.shift();}});
      const randomBefore=wallet.getCharacterWallet(sellerID).balance;
      await randomEngine.runCycle();await randomEngine.stop();assert.equal(samples.length,0);
      const randomReceipt=JSON.parse(store.db.prepare("SELECT result_json FROM nm_operations WHERE quantity=31 AND state='settled'").get().result_json);
      assert.equal(randomReceipt.quantity,31);assert.equal(randomReceipt.grossISK,279);
      assert.equal(wallet.getCharacterWallet(sellerID).balance,randomBefore+279-randomReceipt.taxISK);
      assert.equal((await marketDaemonClient.call('GetOrder',{order_id:randomOrder.orderID})).row.vol_remaining,969);
      report.randomBatch={order:randomOrder,operationKey:randomReceipt.operationKey,result:randomReceipt,
        minimum:1,maximum:100,sample:.75,remaining:969,realScheduler:true};
      report.historyCount+=1;report.goodsQuantity+=31;
      // Real catch-up purchases use fresh fixture prices and current native
      // remaining volume, with distinct simulated history and real credits.
      store.saveConfig({...store.getConfig(),offlinePurchases:true},store.getRevision());
      let offlineTime=ironTime;
      const offlineOptions={adapter:{...adapter,listOrders:async()=>(await adapter.listOrders()).filter(o=>o.orderID===randomOrder.orderID)},
        quotes:{get:async()=>({typeID:34,referencePrice:9,dailyVolume:0,orders:3,confidence:'high',updatedAt:offlineTime})},
        store,getConfig:()=>store.getConfig(),evaluate,clock:()=>offlineTime,random:()=>0};
      const offlineEngine=createEngine(offlineOptions),offlineBefore=wallet.getCharacterWallet(sellerID).balance;
      await offlineEngine.runCycle();offlineTime+=3*900000;
      for(let pass=0;pass<3;pass++)await offlineEngine.runCycle();
      await offlineEngine.runCycle();await offlineEngine.stop();
      const offlineOps=store.db.prepare("SELECT * FROM nm_operations WHERE created_at=? ORDER BY cycle_id").all(offlineTime);
      assert.equal(offlineOps.length,3);assert.equal(new Set(offlineOps.map(o=>o.activity_at)).size,3);
      assert.equal(offlineOps.filter(o=>o.offline_purchase).length,2);
      assert.ok(offlineOps.filter(o=>o.offline_purchase).every(o=>o.activity_at>=Number(o.cycle_id)&&o.activity_at<Number(o.cycle_id)+900000));
      assert.equal(offlineEngine.status().catchingUp,false);
      const remainingOrder=(await adapter.listOrders()).find(o=>o.orderID===randomOrder.orderID);
      assert.equal(remainingOrder.originalQuantity,1000);assert.equal(remainingOrder.quantity,966);
      const offlineReceipts=offlineOps.map(o=>({order:JSON.parse(o.order_json),key:o.operation_key,result:JSON.parse(o.result_json)}));
      assert.ok(offlineReceipts.every(o=>o.result.quantity===1));
      const offlineNet=offlineReceipts.reduce((sum,o)=>sum+o.result.grossISK-o.result.taxISK,0);
      assert.equal(Math.round((wallet.getCharacterWallet(sellerID).balance-offlineBefore)*100),Math.round(offlineNet*100));
      report.offlinePurchases={checks:3,receipts:offlineReceipts,remaining:966,original:1000,
        activityTimes:offlineOps.map(o=>o.activity_at),settledAt:offlineTime,realScheduler:true,netISK:offlineNet};
      report.historyCount+=3;report.goodsQuantity+=3;
      // Let the real daemon commit, then lose just its acknowledgement. The
      // native saga, custody receipts and wallet commands must survive restart.
      const pendingGrant=items.grantItemToCharacterStationHangar(sellerID,stationID,34,100);
      const pendingItem=pendingGrant.data.items?pendingGrant.data.items[0]:pendingGrant.data;
      await service.Handle_PlaceMultiSellOrder([[{itemID:pendingItem.itemID,typeID:34,stationID,quantity:100,price:10}],false,30],session);
      const pendingOrder=(await adapter.listOrders()).find(order=>![listed[0].orderID,corpOrder.orderID,randomOrder.orderID].includes(order.orderID));
      assert.ok(pendingOrder);const pendingKey=`npc-market:integration:lost-ack:${pendingOrder.orderID}`;
      const originalCall=marketDaemonClient.call.bind(marketDaemonClient);let injected=false;
      marketDaemonClient.call=async function(method,params,options){const response=await originalCall(method,params,options);
        if(method==='FillOrder'&&params.idempotency_key===pendingKey+':daemon-fill'&&!injected){injected=true;
          const error=Error('Injected lost daemon acknowledgement after real commit');error.code='MARKET_DAEMON_RPC_TIMEOUT';
          error.marketDaemonOutcomeUnknown=true;error.marketDaemonRequestSent=true;throw error;}return response;};
      await assert.rejects(adapter.buy(pendingOrder,10,pendingKey),/Injected lost daemon acknowledgement/);
      marketDaemonClient.call=originalCall;
      assert.equal((await originalCall('GetOrder',{order_id:pendingOrder.orderID})).row.vol_remaining,90);
      assert.ok(escrow.getEscrowRecord(pendingOrder.orderID).pendingFill);
      report.pending={order:pendingOrder,operationKey:pendingKey,afterWallet:wallet.getCharacterWallet(sellerID).balance};
      report.goodsQuantity+=10;
      const walletGrant=items.grantItemToCharacterStationHangar(sellerID,stationID,34,100);
      const walletItem=walletGrant.data.items?walletGrant.data.items[0]:walletGrant.data;
      await service.Handle_PlaceMultiSellOrder([[{itemID:walletItem.itemID,typeID:34,stationID,quantity:100,price:10}],false,30],session);
      const walletOrder=(await adapter.listOrders()).find(order=>![listed[0].orderID,corpOrder.orderID,randomOrder.orderID].includes(order.orderID));
      assert.ok(walletOrder);const walletKey=`npc-market:integration:wallet-lost-ack:${walletOrder.orderID}`;
      lostWalletKey=walletKey+':wallet:buyer-debit';
      await assert.rejects(adapter.buy(walletOrder,10,walletKey),/Injected lost wallet acknowledgement/);
      assert.equal((await marketDaemonClient.call('GetOrder',{order_id:walletOrder.orderID})).row.vol_remaining,100);
      assert.equal(escrow.getEscrowRecord(walletOrder.orderID).pendingFill.buyerDebited,false);
      assert.equal(wallet.getCharacterWallet(result.buyerID).balance,0);
      report.pending.afterWallet=wallet.getCharacterWallet(sellerID).balance;
      report.walletPending={order:walletOrder,operationKey:walletKey,afterWallet:report.pending.afterWallet};
      report.goodsQuantity+=10;
      fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2));
    } else {
      await authority.enableWalletAuthorityProcess();await adapter.ready();
      const report=JSON.parse(fs.readFileSync(path.join(directory,'result.json'),'utf8'));
      const pending=report.pending,recovered=await adapter.buy(pending.order,10,pending.operationKey);
      assert.equal(recovered.state,'settled');assert.equal(wallet.getCharacterWallet(sellerID).balance,pending.afterWallet);
      assert.equal(escrow.getEscrowRecord(pending.order.orderID).pendingFill,null);
      assert.equal((await marketDaemonClient.call('GetOrder',{order_id:pending.order.orderID})).row.vol_remaining,90);
      const walletPending=report.walletPending,walletRecovered=await adapter.buy(walletPending.order,10,walletPending.operationKey);
      assert.equal(walletRecovered.state,'settled');const expectedFinalWallet=walletPending.afterWallet+walletRecovered.grossISK-walletRecovered.taxISK;
      assert.equal(wallet.getCharacterWallet(sellerID).balance,expectedFinalWallet);
      assert.equal(escrow.getEscrowRecord(walletPending.order.orderID).pendingFill,null);
      assert.equal((await marketDaemonClient.call('GetOrder',{order_id:walletPending.order.orderID})).row.vol_remaining,90);
      const result=await adapter.buy(report.order,10,report.operationKey);assert.equal(result.quantity,10);
      const book=await marketDaemonClient.call('GetOrder',{order_id:report.order.orderID});assert.equal(book.row.vol_remaining,90);
      assert.equal(wallet.getCharacterWallet(sellerID).balance,expectedFinalWallet);assert.equal(wallet.getCharacterMarketTransactions(sellerID).length,report.historyCount+2);
      const iron=report.ironMode;
      await adapter.buy(iron.order,1,iron.operationKey);
      assert.equal(wallet.getCharacterWallet(sellerID).balance,expectedFinalWallet);
      assert.equal((await marketDaemonClient.call('GetOrder',{order_id:iron.order.orderID})).row.vol_remaining,0);
      report.ironMode.restartIdempotency=true;
      const randomBatch=report.randomBatch;
      await adapter.buy(randomBatch.order,31,randomBatch.operationKey);
      assert.equal(wallet.getCharacterWallet(sellerID).balance,expectedFinalWallet);
      assert.equal((await marketDaemonClient.call('GetOrder',{order_id:randomBatch.order.orderID})).row.vol_remaining,report.offlinePurchases.remaining);
      assert.equal(wallet.getCharacterMarketTransactions(sellerID).length,report.historyCount+2);
      report.randomBatch.restartIdempotency=true;
      for(const receipt of report.offlinePurchases.receipts)await adapter.buy(receipt.order,receipt.result.quantity,receipt.key);
      assert.equal(wallet.getCharacterWallet(sellerID).balance,expectedFinalWallet);
      assert.equal(wallet.getCharacterMarketTransactions(sellerID).length,report.historyCount+2);
      assert.equal((await adapter.listOrders()).find(o=>o.orderID===randomBatch.order.orderID).originalQuantity,1000);
      report.offlinePurchases.restartIdempotency=true;
      const corp=report.corporation,corpResult=await adapter.buy(corp.order,10,corp.operationKey);
      assert.equal(corpResult.quantity,10);
      assert.equal(corpWallet.getCorporationWalletBalance(corp.order.ownerID,1000),corp.after);
      assert.equal(corpWallet.getCorporationMarketTransactions(corp.order.ownerID,1000).length,1);
      const corpBook=await marketDaemonClient.call('GetOrder',{order_id:corp.order.orderID});assert.equal(corpBook.row.vol_remaining,90);
      assert.equal(items.listContainerItems(result.buyerID,stationID,items.ITEM_FLAGS.HANGAR).filter(i=>i.typeID===34).reduce((n,i)=>n+i.stacksize,0),report.goodsQuantity);
      const institution=db.read('characters',`/${result.buyerID}`).data;
      assert.equal(institution.accountId,null);assert.equal(institution.suppressSkillBootstrap,true);
      assert.equal(Object.keys(db.read('skills',`/${result.buyerID}`).data||{}).length,0);
      assert.equal(Object.values(db.read('items','/').data||{}).filter(i=>i.ownerID===result.buyerID&&i.typeID!==34).length,0);
      report.restartIdempotency=true;report.ambiguousCommitRecovery=true;report.walletAmbiguousRecovery=true;
      report.institutionNoLogin=true;report.institutionBootstrapGoods=0;report.institutionBootstrapSkills=0;
      fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2));
    }
  }finally{
    await authority.shutdownWalletAuthorityProcess();Service.__testHooks.stopMarketExpiryPollerForTests();
    if(marketDaemonClient._socket)marketDaemonClient._socket.destroy();store.close();db.flushAllSync();await db.shutdown();
  }
}
(process.argv[2]==='purchase'||process.argv[2]==='restart'?phase(process.argv[2],process.argv[3]):parent()).then(()=>process.exit(0),error=>{console.error(error.stack||error);process.exit(1);});
