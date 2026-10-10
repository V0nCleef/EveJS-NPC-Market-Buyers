"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {prepareMarketSource}=require('../lib/marketAdapter');
const source=prepareMarketSource(fs.readFileSync(path.join(process.env.EVEJS_TEST_ROOT||path.resolve(__dirname,'../../EveJS-v0.12.9'),'server/src/services/market/marketProxyService.js'),'utf8'));
function extract(name){const marker=new RegExp(`^(?:async )?function ${name}\\(`,'m'),match=marker.exec(source);
  assert.ok(match,`missing ${name}`);const tail=source.slice(match.index),next=/\n(?:async )?function [A-Za-z]/.exec(tail);
  return next?tail.slice(0,next.index):tail;}
function fixture(mode){
  const balances={1:1000,2:0},receipt=new Map(),moves=new Map();let owner=2,daemonCalls=0,tradeCalls=0,completionCalls=0,queued=0,committed=false;
  let escrow={orderId:'42',remainingQuantity:100};
  const saga={operationKey:'npc-market:saga:42',status:'forward',orderID:'42',buyerCharacterID:1,buyerWalletID:1,
    sellerCharacterID:2,sellerWalletID:2,buyerIsCorp:false,sellerIsCorp:false,destinationStationID:60003760,typeID:34,
    tradedQuantity:10,availableQuantity:100,orderPrice:10,grossCost:100,salesTax:1,stationMarketOwnerID:1000009,
    chargeBuyerWallet:true,itemLegs:[{sourceItem:{itemID:10},quantity:10,forwardKey:'npc-market:saga:42:inventory:0',
      compensationKey:'npc-market:saga:42:inventory-compensate:0',destinationItem:null,compensated:false}],
    npcMarketExpected:{owner_id:2,is_corp:false,type_id:34,station_id:60003760,price:10,vol_remaining:100,source:'player'},
    buyerDebited:false,sellerCredited:false,taxDebited:false,daemonAttempted:false,fillResponse:null,attempt:1};
  async function wallet(id,amount,options){const key=options.idempotencyKey;if(!receipt.has(key)){balances[id]+=amount;receipt.set(key,amount);}return {success:true};}
  const context={
    persistPlayerSellFillSaga:(_e,s)=>{escrow={...escrow,pendingFill:JSON.parse(JSON.stringify(s))};},
    debitCharacterWallet:(id,amount,_d,_o,options)=>wallet(id,-amount,options),
    creditCharacterWallet:(id,amount,_d,_o,options)=>wallet(id,amount,options),
    flushCharacterWalletSagaBoundary:()=>{},ITEM_FLAGS:{HANGAR:4},JOURNAL_ENTRY_TYPE:{MARKET_TRANSACTION:2,TRANSACTION_TAX:54,MARKET_ESCROW:42},
    itemCustody:{CUSTODY_REASON:{MARKET_ESCROW_DELIVER:'deliver',MARKET_FILL_COMPENSATE:'undo'}},
    marketItemCustody:{getEscrowLocationID:()=>9000042,transferItem:input=>{if(!moves.has(input.idempotencyKey)){owner=input.ownerID;moves.set(input.idempotencyKey,1);}return {success:true,data:{item:{itemID:10,ownerID:owner}}};}},
    throwWrappedUserError:(_code,info)=>{throw Error(info.info);},
    marketDaemonClient:{call:async(method,params)=>{
      assert.equal(method,'FillOrder');assert.deepEqual(JSON.parse(JSON.stringify(params.expected)),saga.npcMarketExpected);daemonCalls++;
      if(mode==='zero')return {filled_quantity:0,vol_remaining:100,state:'cancelled',price:10};
      if(mode==='unknown'&&!committed){committed=true;const error=Error('reply lost after commit');error.marketDaemonOutcomeUnknown=true;throw error;}
      committed=true;return {filled_quantity:10,vol_remaining:90,state:'open',price:10,duplicate:daemonCalls>1};}},
    requireDurableMarketSagaWrite:result=>{assert.equal(result.success,true);},
    recordCompletedMarketFillAchievements:()=>({success:true}),
    recordCompletedMarketFillTrade:async s=>{if(!s.tradeRecorded){tradeCalls++;s.tradeRecorded=true;}},
    __npcMarketBuyerBridge:{completed:async()=>{completionCalls++;},hasUnacknowledgedWallet:()=>false},
    removeEscrowRecordDurable:()=>({success:true}),
    putEscrowRecordDurable:value=>{escrow=value;return {success:true};},
    getEscrowRecord:()=>null,computeOrderValue:(price,q)=>price*q,
    queueDurableMarketFillRecovery:async()=>{queued++;},
  };
  vm.createContext(context);
  vm.runInContext(['isDefinitiveMarketDaemonRejection','canCompensateRejectedPrimaryFill',
    'compensatePlayerSellFillSaga','executePlayerSellFillSagaUnlocked'].map(extract).join('\n'),context);
  return {saga,balances,receipt,moves,run:()=>context.executePlayerSellFillSagaUnlocked(escrow,saga,'Tritanium'),
    stats:()=>({owner,daemonCalls,tradeCalls,completionCalls,queued,escrow})};
}
test('actual transformed native saga compensates zero-filled closed order rather than inventing sale',async()=>{
  const f=fixture('zero');await assert.rejects(f.run(),/mismatching fill/);
  assert.deepEqual(f.balances,{1:1000,2:0});const s=f.stats();assert.equal(s.owner,2);
  assert.equal(s.tradeCalls,0);assert.equal(s.completionCalls,0);assert.equal(s.escrow.pendingFill,null);
});
test('actual transformed saga retains ambiguous commit and retries same wallet/custody/fill keys once',async()=>{
  const f=fixture('unknown');await assert.rejects(f.run(),/reply lost/);
  assert.deepEqual(f.balances,{1:900,2:99});assert.equal(f.stats().queued,1);
  await f.run();assert.deepEqual(f.balances,{1:900,2:99});assert.equal(f.moves.size,1);
  assert.equal(f.stats().daemonCalls,2);assert.equal(f.stats().tradeCalls,1);assert.equal(f.stats().completionCalls,1);
  assert.equal(f.stats().escrow.remainingQuantity,90);assert.equal(f.stats().escrow.pendingFill,null);
});
