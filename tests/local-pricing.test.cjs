"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {createQuoteProvider,depthPrice}=require('../lib/quotes'),{createLocalQuoteProvider}=require('../lib/localQuote');
const {DEFAULTS}=require('../lib/config'),{evaluate}=require('../lib/policy');
const now=Date.parse('2026-10-09T20:30:00Z'),context={stationID:60002173,quantity:42};
const npc={typeID:241,localStationID:context.stationID,referencePrice:921.5,source:'EveJS NPC buy offer'};
function fixture({fetchImpl,localQuote=async()=>npc}={}){
 const memory=new Map();let time=now;
 const store={getHTTP:k=>memory.get(k),saveHTTP:(k,v)=>memory.set(k,v),getQuote:k=>memory.get('q:'+k),saveQuote:(k,v)=>memory.set('q:'+k,v)};
 const response=body=>({status:200,ok:true,headers:new Headers({expires:new Date(time+300000).toUTCString()}),json:async()=>body});
 const provider=createQuoteProvider({store,localQuote,clock:()=>time,fetchImpl:fetchImpl||(async()=>response([]))});
 return {provider,memory,response,setTime:t=>time=t};
}
test('missing online references use the actual location NPC offer, label it and retain price caps',async()=>{
 const f=fixture(),q=await f.provider.get(241,DEFAULTS,context);
 assert.equal(q.referenceKind,'local_buy_order');assert.equal(q.referencePrice,921.5);
 assert.equal(f.provider.peek(241,DEFAULTS,context).referencePrice,921.5);
 assert.equal(f.provider.peek(241,DEFAULTS,{...context,stationID:60003760}).referencePrice,null);
 const input={quote:q,price:921.5,quantity:42,config:DEFAULTS,now};
 assert.equal(evaluate(input).chancePercent,35);
 assert.equal(evaluate({...input,price:2800}).reason,'price_cap');
 assert.equal(evaluate({...input,config:{...DEFAULTS,ironMode:false}}).reason,'demand_limit');
 assert.equal((await f.provider.get(241,{...DEFAULTS,useEveAveragePrices:true},context)).referenceKind,'local_buy_order');
 f.provider.close();
});
test('network failures still try local offers; no source invents a price when every source is missing',async()=>{
 let calls=0;
 const f=fixture({fetchImpl:async()=>{throw Error('ESI offline');},localQuote:async()=>{calls++;return npc;}});
 const [a,b]=await Promise.all([f.provider.get(241,DEFAULTS,context),f.provider.get(241,DEFAULTS,context)]);
 assert.equal(calls,1);assert.equal(a.referenceKind,'local_buy_order');assert.equal(b.referencePrice,921.5);
 f.provider.close();
 const missing=fixture({localQuote:async()=>null});
 const q=await missing.provider.get(241,DEFAULTS,context);
 assert.equal(q.referencePrice,null);assert.equal(q.confidence,'unavailable');
 assert.equal(evaluate({price:1,quantity:1,quote:q,config:DEFAULTS,now}).reason,'missing_quote');missing.provider.close();
});
test('a failing hub endpoint does not suppress a usable independent EVE average endpoint',async()=>{
 const urls=[];
 const f=fixture({localQuote:async()=>{throw Error('Local fallback should not be needed');},fetchImpl:async url=>{
  urls.push(url);if(url.includes('/orders/'))return {status:404,ok:false,headers:new Headers()};
  return {status:200,ok:true,headers:new Headers({expires:new Date(now+300000).toUTCString()}),
    json:async()=>url.includes('/prices/')?[{type_id:241,average_price:856.39}]:[]};
 }});
 const q=await f.provider.get(241,DEFAULTS,context);
 assert.equal(q.referenceKind,'eve_average');assert.equal(q.referencePrice,856.39);
 assert.ok(urls.some(url=>url.includes('/prices/')));f.provider.close();
});

test('TQ fallback retries the hub after five minutes while keeping the average timestamp and cache',async()=>{
 let hubCalls=0,averageCalls=0;
 const f=fixture({fetchImpl:async url=>{
  if(url.includes('/orders/'))return f.response([{type_id:241,is_buy_order:false,location_id:60003760,
    price:++hubCalls===1?189900000:900,volume_remain:4}]);
  if(url.includes('/prices/'))averageCalls++;
  return {status:200,ok:true,headers:new Headers({expires:new Date(now+3600000).toUTCString()}),
    json:async()=>url.includes('/prices/')?[{type_id:241,average_price:856.39}]:[{date:'2026-10-08',average:1000,volume:7000}]};
 }});
 // A persisted v4 fallback must not carry the old hour-long derived expiry forward.
 f.memory.set('q:v4:hub:10000002:60003760:241:7:unlimited',
   {typeID:241,referenceKind:'eve_average',referencePrice:1,confidence:'high',updatedAt:now,expiresAt:now+3600000});
 const first=await f.provider.get(241,DEFAULTS,context);
 assert.equal(first.referencePrice,856.39);assert.equal(first.referenceKind,'eve_average');
 assert.equal(first.updatedAt,now);assert.equal(first.expiresAt,now+300000);
 f.setTime(now+299999);assert.equal((await f.provider.get(241,DEFAULTS,context)).referencePrice,856.39);
 assert.equal(hubCalls,1);assert.equal(averageCalls,1);
 f.setTime(now+300001);
 const recovered=await f.provider.get(241,DEFAULTS,context);
 assert.equal(recovered.referencePrice,900);assert.equal(recovered.referenceKind,'hub_orders');
 assert.equal(recovered.updatedAt,now+300001);assert.equal(hubCalls,2);assert.equal(averageCalls,1);
 f.provider.close();
});

test('fallback rechecks never extend an old average timestamp, while forced averages keep their own expiry',async()=>{
 let hubCalls=0,averageCalls=0;
 const f=fixture({fetchImpl:async url=>{
  if(url.includes('/orders/')){hubCalls++;return f.response([]);}
  if(url.includes('/prices/'))averageCalls++;
  return {status:200,ok:true,headers:new Headers({expires:new Date(now+3600000).toUTCString()}),
   json:async()=>url.includes('/prices/')?[{type_id:241,average_price:856.39}]:[]};
 }});
 await f.provider.get(241,DEFAULTS,context);
 f.setTime(now+300001);
 const fallback=await f.provider.get(241,DEFAULTS,context);
 assert.equal(hubCalls,2);assert.equal(averageCalls,1);
 assert.equal(fallback.updatedAt,now);assert.equal(fallback.expiresAt,now+600001);
 const forced=await f.provider.get(241,{...DEFAULTS,useEveAveragePrices:true},context);
 assert.equal(forced.expiresAt,now+3600000);assert.equal(forced.updatedAt,now);
 assert.equal(hubCalls,2);assert.equal(averageCalls,1);assert.equal(forced.hubRecheckAt,undefined);
 f.provider.close();
});
test('local offers refresh and remain separate across quantities and stations; online recovery takes priority',async()=>{
 let calls=0,price=921.5;
 const f=fixture({localQuote:async(typeID,c)=>{calls++;return {...npc,typeID,localStationID:c.stationID,referencePrice:price};}});
 await f.provider.get(241,DEFAULTS,context);await f.provider.get(241,DEFAULTS,context);assert.equal(calls,1);
 await f.provider.get(241,DEFAULTS,{...context,quantity:1});assert.equal(calls,2);
 await f.provider.get(241,DEFAULTS,{...context,stationID:60003760});assert.equal(calls,3);
 price=900;f.setTime(now+30001);assert.equal((await f.provider.get(241,DEFAULTS,context)).referencePrice,900);assert.equal(calls,4);
 f.setTime(now+60001);
 f.memory.set('https://esi.evetech.net/latest/markets/prices/',{body:[{type_id:241,average_price:856.39}],checkedAt:now+60001,expiresAt:now+300000});
 const q=await f.provider.get(241,DEFAULTS,context);assert.equal(q.referenceKind,'eve_average');assert.equal(calls,4);
 assert.equal(f.provider.peek(241,DEFAULTS,context).referenceKind,'eve_average');f.provider.close();
});
test('wrong item bodies and old incompatible derived quotes cannot establish a price',async()=>{
 const f=fixture({localQuote:async()=>null});
 f.memory.set('v3:hub:10000002:60003760:241:7:iron',{typeID:241,referencePrice:189900000,confidence:'high',updatedAt:now,expiresAt:now+999999});
 f.memory.set('https://esi.evetech.net/latest/markets/10000002/orders/?order_type=sell&type_id=241',
   {body:[{type_id:999,is_buy_order:false,location_id:60003760,price:189900000,volume_remain:4}],checkedAt:now,expiresAt:now+300000,pages:1});
 const q=await f.provider.get(241,DEFAULTS,context);assert.equal(q.referencePrice,null);assert.equal(q.orders,0);
 assert.equal(depthPrice([{type_id:999,is_buy_order:false,location_id:60003760,price:100,volume_remain:1}],60003760,241).referencePrice,null);
 f.provider.close();
});
test('stale online price and missing average fall back locally rather than laundering stale timestamps',async()=>{
 const f=fixture();
 f.memory.set('https://esi.evetech.net/latest/markets/10000002/orders/?order_type=sell&type_id=241',
   {body:[{type_id:241,is_buy_order:false,location_id:60003760,price:2500,volume_remain:1}],checkedAt:now-3601000,expiresAt:now+300000,pages:1});
 const q=await f.provider.get(241,DEFAULTS,context);assert.equal(q.referencePrice,921.5);assert.equal(q.referenceKind,'local_buy_order');f.provider.close();
});
test('native fallback uses eligible seeded bids only with native range, quantity and pending-fill rules; never writes',async()=>{
 const seed={type_id:241,region_id:10000043,station_id:60008494,order_id:'npc-1',bid:true,source:'seed',price:921.5,min_volume:1,vol_remaining:100};
 let calls=[];let rows=[seed];
 const get=createLocalQuoteProvider({marketDaemonClient:{call:async(method,params)=>{calls.push({method,params});return {type_id:241,region_id:10000043,buys:rows};}},
   getStationRecord:id=>id===context.stationID?{regionID:10000043}:null,getStationSolarSystemID:()=>30002200,
   isBidOrderInRange:(r,station,system)=>station===context.stationID&&system===30002200&&r.order_id!=='out-of-range',
   hasPendingMarketFillSagaForOrder:id=>id==='pending'});
 assert.equal((await get(241,context)).referencePrice,921.5);
 assert.deepEqual(calls,[{method:'GetOrders',params:{region_id:10000043,type_id:241}}]);
 rows=[{...seed,source:'player',price:1e9},{...seed,order_id:'out-of-range',price:1e8},{...seed,order_id:'pending',price:1e7},
   {...seed,type_id:999,price:1e6},{...seed,min_volume:100,price:1e5},{...seed,bid:false,price:1e4},seed];
 assert.equal((await get(241,context)).referencePrice,921.5);
 rows=rows.slice(0,-1);assert.equal(await get(241,context),null);
 rows=[{...seed,min_volume:100,vol_remaining:10}];assert.equal((await get(241,context)).referencePrice,921.5);
 assert.equal(await get(241,{...context,quantity:1}),null);
 assert.equal(await get(241,{...context,stationID:999}),null);
 assert.ok(calls.every(x=>x.method==='GetOrders'));
});
test('advisory and My Orders pass actual station/quantity through the same fallback provider',async()=>{
 const {installService}=require('../lib/service');const f=fixture();
 const order={orderID:'1315',sellerID:42,typeID:241,stationID:context.stationID,quantity:42,price:921.5};
 const allowances=[];class Service{}
 installService(Service,{store:{getConfig:()=>DEFAULTS,getRevision:()=>1,statistics:{activeOrders:()=>({activeCount:1,soldISK:0,remainingISK:38703,totalISK:38703})}},quotes:f.provider,
  engine:{previewAllowance:o=>{allowances.push(o);return {availableISK:1e8,remainingDemand:100};}},
  adapter:{listOrders:async()=>[order],ready:async()=>{}},hasStaffAccountRole:()=>true,clock:()=>now});
 const service=new Service(),session={charid:42};
 const advisory=JSON.parse(await service.Handle_NpcMarketQuote([JSON.stringify({typeID:241,price:921.5,quantity:42,stationID:context.stationID,duration:90})],session));
 assert.equal(advisory.success,true);assert.equal(advisory.preview.referenceKind,'local_buy_order');assert.equal(advisory.preview.chancePercent,35);
 const orders=JSON.parse(await service.Handle_NpcMarketGetOrders([],session));
 assert.equal(orders.orders[0].preview.referencePrice,921.5);assert.equal(orders.orders[0].preview.chancePercent,35);
 assert.ok(allowances.every(o=>o.stationID===context.stationID&&o.quantity===42));f.provider.close();
});
