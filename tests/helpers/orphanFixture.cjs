'use strict';
// Small synthetic durable owner stand-in; real owner integration is separate.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createStore}=require('../../lib/store'),{createNativeBridge}=require('../../lib/settlement'),{createEngine}=require('../../lib/engine');
const E=require('../../lib/orphanEvidence');
const root=path.resolve(process.env.EVEJS_TEST_ROOT||path.join(__dirname,'../../../EveJS-v0.12.9'));
const Database=require(path.join(root,'server/node_modules/better-sqlite3'));
const clone=value=>JSON.parse(JSON.stringify(value));
const FILETIME=116444736000000000n,t0=Date.UTC(2026,10,1);
function authorityFingerprint(leg){return crypto.createHash('sha256').update(JSON.stringify(E.canonical({commandType:'character.adjust-isk',payload:{charId:leg.ownerID,amount:leg.amountCents/100,options:leg.options}}))).digest('base64url');}
function legacy(key,id,amount,entry,owner1,owner2,reference,at,previous,description){
  const fp={charId:id,amount,referenceID:reference,entryTypeID:entry,ownerID1:owner1,ownerID2:owner2,accountKey:1000,description,currency:1};
  return {idempotencyKey:key,fingerprint:JSON.stringify(fp),result:{data:{characterID:id,balance:previous+amount},previousBalance:previous,delta:amount,
    journalEntry:{transactionID:at*1000,transactionDate:(BigInt(at)*10000n+FILETIME).toString(),referenceID:reference,entryTypeID:entry,ownerID1:owner1,ownerID2:owner2,accountKey:1000,description,currency:1,amount,balance:previous+amount}}};
}
function custody(key,item,quantity,from,to,reason,actor,at,{whole=false}={}){
  const after={...item,ownerID:to.ownerID,locationID:to.locationID,flagID:4,quantity,stacksize:quantity};
  return {schemaVersion:3,receiptKey:'item-custody:local:'+crypto.createHash('sha256').update(key).digest('hex'),state:'completed',
    operation:from.ownerID===to.ownerID?'move-item-to-location':'transfer-item-to-owner-location',completedAtMs:at,
    fingerprint:{commandType:'item-custody.transfer',route:'local-move',reason,actor,source:from,destination:to,itemSpec:{itemID:item.itemID,quantity:whole?null:quantity},destinationItemPatch:null},
    metadata:{itemCustody:{commandType:'item-custody.transfer',idempotencyKey:key,reason,sequence:1}},resultData:{quantity,changes:[{previousData:item,item:after,removed:false}]}};
}
function fixture(t,{saturated=true}={}){
  const scratch=path.resolve(__dirname,'../../.test-runtime');fs.mkdirSync(scratch,{recursive:true});
  const directory=fs.mkdtempSync(path.join(scratch,'orphan-recovery-')),modFile=path.join(directory,'mod.sqlite');
  let store=createStore(modFile,{Database}),failAfter=null,failBefore=null,clock=t0+2000;
  const key='npc-market:1000000:2:34:60003760',order={orderID:'42',sellerID:2,ownerID:2,isCorp:false,accountKey:null,typeID:34,stationID:60003760,regionID:10000002,price:10,quantity:100,originalQuantity:100,source:'player'};
  const escrow=9200000042,sourceItem={itemID:10,typeID:34,ownerID:2,locationID:escrow,flagID:4,quantity:100,stacksize:100};
  const saga={schemaVersion:1,direction:'buyer-consumes-player-sell',operationKey:key,orderID:'42',attempt:1,status:'forward',buyerCharacterID:3,buyerWalletID:3,buyerIsCorp:false,
    sellerCharacterID:2,sellerWalletID:2,sellerIsCorp:false,destinationStationID:60003760,typeID:34,tradedQuantity:10,availableQuantity:100,orderPrice:10,grossCost:100,salesTax:1,
    stationMarketOwnerID:1000009,chargeBuyerWallet:true,crossingOrderID:null,priceImprovementRefund:0,buyerDebited:false,sellerCredited:false,taxDebited:false,daemonAttempted:false,fillResponse:null,
    itemLegs:[{sourceItem,quantity:10,forwardKey:key+':inventory:0',compensationKey:key+':inventory-compensate:0',destinationItem:null,compensated:false}],createdAt:new Date(t0).toISOString()};
  const owners={2:{balance:999,walletOperationReceipts:[],walletAuthorityReceipts:[]},3:{balance:0,walletOperationReceipts:[],walletAuthorityReceipts:[]}};
  for(const r of [legacy(key+':funding',3,100,3,3,3,3,t0+10,0,'Funding'),legacy(key+':wallet:buyer-debit',3,-100,2,3,2,60003760,t0+20,100,'Buyer debit'),
    legacy(key+':wallet:seller-credit',2,100,2,3,2,60003760,t0+40,900,'Seller credit'),legacy(key+':wallet:tax-debit',2,-1,54,1000009,2,60003760,t0+50,1000,'Tax')]){
    const id=JSON.parse(r.fingerprint).charId;owners[id].walletOperationReceipts.unshift(r);
    owners[id].walletAuthorityReceipts.unshift({commandID:r.idempotencyKey,commandType:'character.adjust-isk',fingerprint:'fixture-original',committedAt:new Date(t0+60).toISOString(),result:{success:true,...clone(r.result)}});
  }
  if(saturated)for(const id of [2,3]){
    while(owners[id].walletOperationReceipts.length<512)owners[id].walletOperationReceipts.push({idempotencyKey:'fixture:older:'+owners[id].walletOperationReceipts.length});
    while(owners[id].walletAuthorityReceipts.length<1024)owners[id].walletAuthorityReceipts.push({commandID:'fixture:older:'+owners[id].walletAuthorityReceipts.length});
  }
  const from={kind:'owner-location',ownerID:2,locationID:escrow,flagID:4},to={kind:'owner-location',ownerID:3,locationID:60003760,flagID:4};
  const forward=custody(key+':inventory:0',sourceItem,10,from,to,'market-escrow-deliver',3,t0+30);
  forward.resultData.changes=[{previousData:sourceItem,item:{...sourceItem,quantity:90,stacksize:90},removed:false},
    {previousData:{quantity:0},item:{itemID:11,typeID:34,ownerID:3,locationID:60003760,flagID:4,quantity:10,stacksize:10},removed:false}];
  const terminalKey='market:market-escrow-return:42:10:available:90:move:whole:2:9200000042:4:2:60003760:4';
  const terminal=custody(terminalKey,{...sourceItem,quantity:90,stacksize:90},90,from,{...from,locationID:60003760},'market-escrow-return',2,t0+1010,{whole:true});
  const state={owners,items:{10:{...sourceItem,locationID:60003760,quantity:90,stacksize:90},11:clone(forward.resultData.changes[1].item)},
    custody:{[key+':inventory:0']:forward,[terminalKey]:terminal},effects:{goods:0,wallet:0},calls:{goods:0,wallet:0}};
  const ownerDB=new Database(path.join(directory,'synthetic-owners.sqlite'));ownerDB.pragma('synchronous=FULL');ownerDB.exec('CREATE TABLE state(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
  const persist=()=>ownerDB.prepare("INSERT INTO state VALUES('owners',?) ON CONFLICT(key) DO UPDATE SET json=excluded.json").run(JSON.stringify(state));persist();
  const response={order_id:'42',owner_id:2,is_corp:false,station_id:60003760,type_id:34,price:10,filled_quantity:0,vol_remaining:100,state:'expired'};
  const market={fillReceipt:{idempotency_key:key+':daemon-fill',order_id:42,fill_quantity:10,response_json:JSON.stringify(response),created_at:new Date(t0+1000).toISOString()},
    currentOrder:{order_id:'42',owner_id:2,is_corp:false,state:'expired',source:'player',row:{type_id:34,station_id:60003760,price:10,vol_remaining:100,bid:false,source:'player'}}};
  const api={qualified:true,authorityReceiptLimit:1024,legacyReceiptLimit:512,readMarket:async()=>clone(market),
    readWallet:id=>clone(state.owners[id]),readItem:id=>clone(state.items[id]||null),readCustody:k=>clone(state.custody[k]||null),expectedAuthority:authorityFingerprint,
    evidence:async input=>({...input,...clone(market),hostQualified:true,walletMaxBalance:2000000000,wallets:clone(state.owners),
      buyerIdentity:{accountId:null,npcMarketInstitution:'npc-market-buyers:institution:v1'},escrowLocation:escrow,terminalReturnKey:terminalKey,
      forwardReceipt:clone(state.custody[key+':inventory:0']),terminalReceipt:clone(state.custody[terminalKey]),oldInventoryCompensation:state.custody[key+':inventory-compensate:0']||null,items:clone(state.items)}),
    issueCustody:leg=>{
      state.calls.goods++;if(failBefore==='goods-return'){failBefore=null;throw Error('before send goods-return');}
      let receipt=state.custody[leg.key];
      if(!receipt){const item=state.items[leg.itemID];if(!item||item.ownerID!==leg.source.ownerID)throw Error('Wrong synthetic custody source');
        receipt=custody(leg.key,item,leg.quantity,leg.source,leg.destination,leg.reason,leg.actor,++clock);
        state.items[leg.itemID]=clone(receipt.resultData.changes[0].item);state.custody[leg.key]=receipt;state.effects.goods++;persist();}
      if(failAfter==='goods-return'){failAfter=null;throw Error('lost reply goods-return');}return {success:true};
    },
    issueWallet:async(leg,metadata)=>{
      state.calls.wallet++;if(failBefore===leg.name){failBefore=null;throw Error('before send '+leg.name);}
      const owner=state.owners[leg.ownerID];let cached=owner.walletAuthorityReceipts.find(r=>r.commandID===leg.key);
      if(!cached){
        const previous=owner.balance,delta=leg.amountCents/100;
        if(previous+delta<0)return {success:false,errorMsg:'INSUFFICIENT_FUNDS'};
        if(leg.options.requireExactCredit!==true)throw Error('Exact credit guard missing');
        if(previous+delta>2000000000)return {success:false,errorMsg:'WALLET_LIMIT'};
        const r=legacy(leg.key,leg.ownerID,delta,leg.entryTypeID,leg.ownerID1,leg.ownerID2,leg.referenceID,++clock,previous,leg.description);
        owner.balance+=delta;owner.walletOperationReceipts.unshift(r);owner.walletOperationReceipts=owner.walletOperationReceipts.slice(0,512);
        cached={commandID:metadata.commandID,commandType:'character.adjust-isk',fingerprint:authorityFingerprint(leg),committedAt:new Date(clock).toISOString(),result:{success:true,...clone(r.result)}};
        owner.walletAuthorityReceipts.unshift(cached);owner.walletAuthorityReceipts=owner.walletAuthorityReceipts.slice(0,1024);state.effects.wallet++;persist();
      }
      if(failAfter===leg.name){failAfter=null;throw Error('lost reply '+leg.name);}return clone(cached.result);
    }};
  const native={orphan:api,getEscrowRecord:()=>null,marketDaemonClient:{call:async()=>({capabilities:['conditional-fill-v1']})},authority:{isWalletAuthorityProcessEnabled:()=>true},
    walletReceipts:{findOwnerReceipt:({ownerID},k)=>state.owners[ownerID].walletAuthorityReceipts.find(r=>r.commandID===k),isOwnerReceiptListSaturated:({ownerID})=>state.owners[ownerID].walletAuthorityReceipts.length>=1024}};
  let bridge=createNativeBridge(native);bridge.attach(store);
  createEngine({store,adapter:{},getConfig:()=>store.getConfig()});
  store.db.prepare("INSERT INTO nm_native_meta VALUES('buyerID','3')").run();
  store.db.prepare('INSERT INTO nm_native_ops VALUES (?,?,?,?,?,?,?,?)').run(key,E.hash(JSON.stringify({order,quantity:10})),'pending',JSON.stringify(order),10,JSON.stringify(saga),null,t0);
  store.db.prepare('INSERT INTO nm_funding VALUES (?,?,?,?)').run(key,'2026-11-01',10000,'committed');
  store.db.prepare('INSERT INTO nm_wallet_intents VALUES (?,?,?,?)').run(key+':wallet:tax-debit',2,0,'pending');
  store.db.prepare(`INSERT INTO nm_operations(operation_key,cycle_id,group_key,day,seller_id,type_id,quantity,cost_cents,state,order_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(key,'1000000','2:34:60003760','2026-11-01',2,34,10,10000,'pending',JSON.stringify(order),t0,t0);
  const engine=()=>createEngine({store,adapter:{recover:()=>bridge.recover(),buy:(...args)=>bridge.buy(...args),listOrders:async()=>{throw Error('Fresh buying is forbidden in recovery fixture');}},getConfig:()=>({...store.getConfig(),enabled:false}),clock:()=>clock,log:{error(){}}});
  t.after(()=>{store.close();ownerDB.close();if(!fs.realpathSync(directory).startsWith(fs.realpathSync(scratch)+path.sep))throw Error('Invalid fixture cleanup');fs.rmSync(directory,{recursive:true,force:true});});
  return {directory,key,order,saga,api,native,state,market,get store(){return store;},get bridge(){return bridge;},engine,
    failAfter:name=>{failAfter=name;},failBefore:name=>{failBefore=name;},persist,
    reopen(){store.close();const saved=JSON.parse(ownerDB.prepare("SELECT json FROM state WHERE key='owners'").get().json);Object.assign(state,saved);store=createStore(modFile,{Database});bridge=createNativeBridge(native);bridge.attach(store);},
    totalItems:()=>Object.values(state.items).reduce((sum,item)=>sum+item.stacksize,0)};
}
module.exports={fixture,clone,legacy,custody,authorityFingerprint,t0};
