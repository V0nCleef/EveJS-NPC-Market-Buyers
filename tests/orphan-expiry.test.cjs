'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {prepareMarketSource}=require('../lib/marketAdapter');
const root=path.resolve(process.env.EVEJS_TEST_ROOT||path.join(__dirname,'../../EveJS-v0.12.9'));
const Database=require(path.join(root,'server/node_modules/better-sqlite3'));
const source=prepareMarketSource(fs.readFileSync(path.join(root,'server/src/services/market/marketProxyService.js'),'utf8'));
function extract(name){const match=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(source);assert.ok(match,name);
  const tail=source.slice(match.index),next=/\n(?:async )?function [A-Za-z]/.exec(tail);return next?tail.slice(0,next.index):tail;}
test('real terminal poll defers without acknowledging or failing boot, survives cold restart, then returns compensated escrow once',async t=>{
  const scratch=path.resolve(__dirname,'../.test-runtime');fs.mkdirSync(scratch,{recursive:true});
  const directory=fs.mkdtempSync(path.join(scratch,'expiry-defer-')),filename=path.join(directory,'owners.sqlite');
  let db=new Database(filename);db.pragma('synchronous=FULL');
  db.exec('CREATE TABLE state(key TEXT PRIMARY KEY,json TEXT); CREATE TABLE receipts(key TEXT PRIMARY KEY); CREATE TABLE jobs(key TEXT PRIMARY KEY,json TEXT);');
  const put=(key,value)=>db.prepare('INSERT INTO state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(key,JSON.stringify(value));
  const get=key=>{const row=db.prepare('SELECT json FROM state WHERE key=?').get(key);return row?JSON.parse(row.json):null;};
  const key='npc-market:expiry:42',station=60003760;
  const saga={operationKey:key,direction:'buyer-consumes-player-sell',orderID:'42',buyerCharacterID:3,buyerWalletID:3,sellerCharacterID:2,sellerWalletID:2,
    buyerIsCorp:false,sellerIsCorp:false,destinationStationID:station,typeID:34,tradedQuantity:10,grossCost:100,salesTax:0,attempt:1,status:'forward',
    buyerDebited:true,sellerCredited:true,taxDebited:false,priceImprovementRefunded:false,
    itemLegs:[{destinationItem:{itemID:11,typeID:34,ownerID:3,locationID:station,flagID:4,quantity:10,stacksize:10},quantity:10,compensated:false,
      compensationKey:key+':inventory-compensate:0'}]};
  put('cursor','0');put('escrow:42',{orderId:'42',ownerId:2,escrowType:'sell',state:'open',remainingQuantity:100,pendingFill:saga});
  put('escrow:43',{orderId:'43',ownerId:4,escrowType:'sell',state:'open',remainingQuantity:20});
  put('items',[{itemID:10,typeID:34,ownerID:2,locationID:9200000042,flagID:4,quantity:90,stacksize:90},saga.itemLegs[0].destinationItem,
    {itemID:12,typeID:34,ownerID:4,locationID:9200000043,flagID:4,quantity:20,stacksize:20}]);
  put('wallets',{2:100,3:0});
  const events=[{event_id:'1',event_type:'expired',order:{order_id:'42',owner_id:2,is_corp:false,state:'expired',row:{bid:false,station_id:station,type_id:34,vol_remaining:100}}},
    {event_id:'2',event_type:'expired',order:{order_id:'43',owner_id:4,is_corp:false,state:'expired',row:{bid:false,station_id:station,type_id:34,vol_remaining:20}}}];
  function context(){
    let pollCalls=0;
    const escrow=id=>get('escrow:'+id);
    const list=()=>db.prepare("SELECT json FROM state WHERE key LIKE 'escrow:%' ORDER BY key").all().map(row=>JSON.parse(row.json));
    const nativeTransfer=input=>{
      const id=input.idempotencyKey||`terminal:${input.orderID}:${input.item.itemID}`;
      if(!db.prepare('SELECT 1 FROM receipts WHERE key=?').get(id)){
        const items=get('items'),item=items.find(row=>row.itemID===input.item.itemID);
        assert.equal(item.ownerID,input.item.ownerID);assert.equal(item.locationID,input.item.locationID);
        item.ownerID=input.ownerID;item.locationID=input.locationID;item.flagID=input.flagID;put('items',items);
        db.prepare('INSERT INTO receipts VALUES (?)').run(id);
      }
      const item=get('items').find(row=>row.itemID===input.item.itemID);return {success:true,data:{item,changes:[{item}]}};
    };
    const adjust=async(id,amount,_description,_reference,options)=>{
      if(!db.prepare('SELECT 1 FROM receipts WHERE key=?').get(options.idempotencyKey)){
        const wallets=get('wallets');wallets[id]+=amount;put('wallets',wallets);db.prepare('INSERT INTO receipts VALUES (?)').run(options.idempotencyKey);
      }return {success:true};
    };
    const ctx={marketExpiryPollPromise:null,durableMarketScheduler:{list:async()=>db.prepare('SELECT json FROM jobs').all().map(row=>JSON.parse(row.json)),
      schedule:async job=>db.prepare('INSERT OR IGNORE INTO jobs VALUES (?,?)').run(job.jobID,JSON.stringify(job))},
      requestExpirySweepIfDue:async()=>{},getLastProcessedOrderEventId:()=>BigInt(get('cursor')),
      setLastProcessedOrderEventId:value=>put('cursor',String(value)),normalizeBigInt:(value,fallback)=>value==null?fallback:BigInt(value),
      marketDaemonClient:{call:async(method,params)=>{assert.equal(method,'GetOrderEvents');pollCalls++;return events.filter(event=>BigInt(event.event_id)>BigInt(params.after_event_id));}},
      normalizeOrderId:value=>String(value||'0'),normalizePositiveInteger:(value,fallback)=>Number(value)>0?Number(value):fallback,
      normalizeBoolean:Boolean,getOwnerOrderResponseOrder:value=>value.row||value,getEscrowRecord:escrow,getEscrowType:value=>value?.escrowType,
      roundIsk:value=>Number(value),creditCharacterWallet:adjust,debitCharacterWallet:(id,amount,...args)=>adjust(id,-amount,...args),
      flushCharacterWalletSagaBoundary:()=>{},getMarketCounterpartyOwnerID:()=>1000009,JOURNAL_ENTRY_TYPE:{MARKET_TRANSACTION:2,MARKET_ESCROW:42,TRANSACTION_TAX:54},
      resolveEscrowReturnDestination:(_record,ownerID,locationID)=>({ownerID,locationID,flagID:4}),
      listEscrowItemsForOrder:(id,owner)=>get('items').filter(item=>item.ownerID===owner&&item.locationID===9200000000+Number(id)),
      marketItemCustody:{transferItem:nativeTransfer,getEscrowLocationID:id=>9200000000+Number(id)},
      itemCustody:{CUSTODY_REASON:{MARKET_ESCROW_RETURN:'market-escrow-return',MARKET_FILL_COMPENSATE:'market-fill-compensate'}},
      ITEM_FLAGS:{HANGAR:4},throwWrappedUserError:(_code,info)=>{throw Error(info.info);},ensureArray:value=>Array.isArray(value)?value:[],
      buildCreatedPreviousState:()=>({}),requireDurableMarketSagaWrite:result=>assert.equal(result.success,true),
      removeEscrowRecordDurable:id=>{db.prepare('DELETE FROM state WHERE key=?').run('escrow:'+id);return {success:true};},
      putEscrowRecordDurable:value=>{put('escrow:'+value.orderId,value);return {success:true};},
      persistPlayerSellFillSaga:(anchor,active)=>put('escrow:'+anchor.orderId,{...anchor,pendingFill:JSON.parse(JSON.stringify(active))}),
      notifyInventoryChangesToCharacter:()=>{},fanCorporationOfficeInventoryChanges:()=>{},notifyOwnOrdersChanged:()=>{},ORDER_REASON_EXPIRED:1,ORDER_REASON_CANCELLED:2,
      log:{warn(){},error(){}},DURABLE_FILL_RECOVERY_JOB_TYPE:'market-fill',listEscrowRecords:list,reconcilePlacingSellEscrowRecords:async()=>{},
      buildDurableMarketExpiryJob:()=>null,fetchOrderById:async id=>events.find(event=>event.order.order_id===String(id)).order,
      scheduleDurableMarketOrderExpiry:async()=>{},isMarketDaemonUnavailableError:()=>false,isMarketDaemonMissingOrderError:()=>false,sweepStrandedMarketEscrowItems:async()=>{},
    };
    vm.createContext(ctx);vm.runInContext(['applyTerminalOrderEvent','moveEscrowItemsBackToSeller','processPendingExpiryEvents','buildDurableMarketFillRecoveryJob',
      'reconcileDurableMarketOrders','compensatePlayerSellFillSaga'].map(extract).join('\n'),ctx);
    return {ctx,pollCalls:()=>pollCalls};
  }
  t.after(()=>{db.close();if(!fs.realpathSync(directory).startsWith(fs.realpathSync(scratch)+path.sep))throw Error('Invalid expiry fixture cleanup');fs.rmSync(directory,{recursive:true,force:true});});
  let c=context();await c.ctx.reconcileDurableMarketOrders();assert.equal(get('cursor'),'0');assert.equal(c.pollCalls(),1);
  assert.equal(get('items').filter(item=>item.locationID===9200000042).reduce((sum,item)=>sum+item.quantity,0),90);
  assert.ok(get('escrow:42').pendingFill);assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs').get().n,1);
  db.close();db=new Database(filename);c=context();await c.ctx.reconcileDurableMarketOrders();assert.equal(get('cursor'),'0');assert.equal(c.pollCalls(),1);
  const anchor=get('escrow:42');await c.ctx.compensatePlayerSellFillSaga(anchor,anchor.pendingFill,'Tritanium');
  assert.equal(get('escrow:42').pendingFill,null);assert.equal(get('items').filter(item=>item.locationID===9200000042).reduce((sum,item)=>sum+item.quantity,0),100);
  await c.ctx.processPendingExpiryEvents();assert.equal(get('cursor'),'2');assert.equal(get('escrow:42'),null);assert.equal(get('escrow:43'),null);
  assert.equal(get('items').reduce((sum,item)=>sum+item.quantity,0),120);assert.ok(get('items').every(item=>item.locationID===station));
  const receipts=db.prepare('SELECT COUNT(*) n FROM receipts').get().n;db.close();db=new Database(filename);c=context();await c.ctx.reconcileDurableMarketOrders();
  assert.equal(get('cursor'),'2');assert.equal(db.prepare('SELECT COUNT(*) n FROM receipts').get().n,receipts);assert.deepEqual(get('wallets'),{2:0,3:100});
});
