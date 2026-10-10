"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {validateConfig,DEFAULTS}=require("../lib/config"),{evaluate,priceChance,batchQuantity,batchRange}=require("../lib/policy"),{depthPrice,historyStats,createQuoteProvider}=require("../lib/quotes");
const now=Date.parse("2026-10-09T18:00:00Z");
const quote={referencePrice:6,dailyVolume:100000000,orders:3,confidence:"high",updatedAt:now};
test("single pricing policy drives chance, price cap and explicit stale/missing data pauses",()=>{
 const run=(price,extra={})=>evaluate({price,quantity:100000,quote,config:{...DEFAULTS,ironMode:false},now,...extra});
 assert.equal(run(6).chancePercent,35);assert.ok(Math.abs(run(6.9).chancePercent-14)<1e-10);
 assert.equal(run(8).reason,"price_cap");assert.equal(run(8).chancePercent,0);
 assert.equal(run(4).warning,"low");
 assert.equal(run(6,{quote:{...quote,updatedAt:now-3601000}}).reason,"stale_quote");
 assert.equal(run(6,{quote:null}).eligible,false);
 assert.equal(run(6,{availableISK:5}).maxQuantity,0);
 assert.equal(run(6,{availableISK:18}).maxQuantity,3);
});
test("purchase interval is fixed at fifteen minutes and config fails closed",()=>{
 assert.equal(validateConfig().intervalSeconds,900);
 assert.throws(()=>validateConfig({intervalSeconds:600}),/fixed/);
 assert.equal(priceChance(100,DEFAULTS),35);
 assert.throws(()=>validateConfig({dailyBudgetISK:Infinity}));
 assert.throws(()=>validateConfig({enabled:"true"}));assert.throws(()=>validateConfig({unknown:true}));
 assert.throws(()=>validateConfig({ironMode:"true"}));
 assert.equal(validateConfig().offlinePurchases,false);
 assert.equal(validateConfig().useEveAveragePrices,false);
 assert.equal(validateConfig({useEveAveragePrices:true}).useEveAveragePrices,true);
 assert.throws(()=>validateConfig({useEveAveragePrices:'true'}));
 assert.equal(Object.hasOwn(validateConfig({minimumOrders:17}),'minimumOrders'),false);
 assert.equal(validateConfig({offlinePurchases:true}).offlinePurchases,true);
 assert.throws(()=>validateConfig({offlinePurchases:'true'}));
 assert.throws(()=>validateConfig({maxPricePercent:110,warnAbovePercent:120}));
});
test('policy validation sends stable translated error keys and setting parameters',()=>{
 const {uiError}=require('../lib/uiErrors');
 const errorFor=input=>{try{validateConfig(input);}catch(error){return uiError(error);}throw Error('Expected validation failure');};
 assert.deepEqual(errorFor({batchPercent:0}),{errorKey:'setting_range',errorParams:{setting:'batchPercent',minimum:'0.01',maximum:'100'}});
 assert.equal(errorFor({intervalSeconds:600}).errorKey,'interval_error');
 assert.equal(errorFor({randomBatch:'yes'}).errorKey,'boolean_error');
 assert.equal(errorFor({minimumBatchPercent:11}).errorKey,'batch_range_error');
 assert.equal(uiError(Error('Policy changed in another window; reload before saving')).errorKey,'revision_error');
 assert.equal(uiError(Error('Unexpected internal diagnostic')).errorKey,'request_failed');
});
test('iron mode gives a single fair low-volume item a chance and ignores spending caps',()=>{
 const one={price:12000,quantity:1,quote:{...quote,referencePrice:12590,dailyVolume:15},config:DEFAULTS,now,
   availableISK:0,remainingDemand:0};
 assert.equal(evaluate({...one,config:{...DEFAULTS,ironMode:false}}).reason,'demand_limit');
 const result=evaluate(one);assert.equal(result.eligible,true);assert.equal(result.maxQuantity,1);
 assert.ok(result.chancePercent>35);assert.equal(result.warning,'fair');
 const costly=evaluate({...one,price:1000000000,quote:{...one.quote,referencePrice:1000000000,dailyVolume:0}});
 assert.equal(costly.chancePercent,35);assert.equal(costly.maxQuantity,1);
 assert.equal(evaluate({...one,price:20000}).reason,'price_cap');
 assert.equal(evaluate({...one,quote:null}).eligible,false);
 assert.equal(evaluate({...one,quote:{...one.quote,confidence:'low'}}).reason,'thin_market');
 assert.equal(evaluate({...one,quote:{...one.quote,updatedAt:now-3601000}}).reason,'stale_quote');
 assert.equal(evaluate({...one,config:{...DEFAULTS,enabled:false}}).reason,'disabled');
});
test('limited mode distinguishes volume quotas from exhausted budgets',()=>{
 const input={price:6,quantity:1,quote,now,config:{...DEFAULTS,ironMode:false}};
 assert.equal(evaluate({...input,remainingDemand:0}).reason,'demand_limit');
 assert.equal(evaluate({...input,availableISK:0}).reason,'budget_limit');
});
test('random batches scale with remaining stock, favor small buys and keep single units sellable',()=>{
 const sample=(draw,quantity=1000000,config=DEFAULTS,cap=quantity)=>batchQuantity({quantity,config,draw,cap});
 assert.deepEqual(batchRange(1000000,DEFAULTS),{minimum:100,maximum:100000});
 assert.equal(sample(0),100);assert.equal(sample(2/3),10000);
 assert.ok(sample(0.999999)<=100000);assert.equal(sample(0,900000),90);
 assert.equal(sample(.5,1),1);assert.equal(sample(.9,7),1);
 assert.equal(sample(0,1000000,{...DEFAULTS,randomBatch:false}),100000);
 assert.equal(sample(.99,1000000,DEFAULTS,3),3);
 const sizes=Array.from({length:1000},(_,i)=>sample(i/1000));
 assert.ok(sizes.every(q=>Number.isSafeInteger(q)&&q>=100&&q<=100000));
 assert.ok(sizes[500]<4000);assert.ok(sizes.filter(q=>q<1000).length>300);
 assert.throws(()=>sample(1));assert.throws(()=>validateConfig({minimumBatchPercent:20,batchPercent:10}));
 assert.throws(()=>validateConfig({randomBatch:'yes'}));
 // An unused hidden random minimum must not prevent editing a fixed batch.
 const fixed=validateConfig({randomBatch:false,minimumBatchPercent:5,batchPercent:1});
 assert.equal(fixed.minimumBatchPercent,5);assert.equal(batchQuantity({quantity:1000,config:fixed,draw:0}),10);
 assert.throws(()=>validateConfig({...fixed,randomBatch:true}),/Minimum batch/);
});
test("station depth ignores foreign orders, and a single bait unit cannot set the reference",()=>{
 const rows=[{type_id:34,is_buy_order:false,location_id:60003760,price:1,volume_remain:1},{type_id:34,is_buy_order:false,location_id:60003760,price:6,volume_remain:999},{type_id:34,is_buy_order:false,location_id:99,price:.1,volume_remain:1000000}];
 assert.equal(depthPrice(rows,60003760).referencePrice,5.9);
 assert.equal(depthPrice(rows,99).referencePrice,.1);
 assert.equal(depthPrice(rows,100).referencePrice,null);
 const history=[{date:"2026-10-08",average:6,volume:7000},{date:"2026-10-09",average:500,volume:1000000}];
 assert.equal(historyStats(history,7,now).dailyVolume,1000);
});

function quoteFixture(fetchImpl){
 const memory=new Map(),store={getHTTP:k=>memory.get(k),saveHTTP:(k,v)=>memory.set(k,v),getQuote:k=>memory.get('q:'+k),saveQuote:(k,v)=>memory.set('q:'+k,v)};
 return createQuoteProvider({store,fetchImpl,clock:()=>now});
}
const response=body=>({status:200,ok:true,headers:new Headers({expires:new Date(now+300000).toUTCString()}),json:async()=>body});
test('one valid hub sell order suffices even with an old saved minimum of seventeen or empty history',async()=>{
 const urls=[];
 const provider=quoteFixture(async url=>{urls.push(url);return response(url.includes('/orders/')?
   [{type_id:34,is_buy_order:false,location_id:60003760,price:6,volume_remain:1}]:[]);});
 const q=await provider.get(34,{...DEFAULTS,minimumOrders:17});
 assert.equal(q.orders,1);assert.equal(q.referencePrice,6);assert.equal(q.confidence,'high');
 assert.equal(q.referenceKind,'hub_orders');assert.equal(urls.some(x=>x.includes('/prices/')),false);
 assert.equal(evaluate({price:6,quantity:1,quote:q,config:DEFAULTS,now}).chancePercent,35);
 assert.equal(evaluate({price:8,quantity:1,quote:q,config:DEFAULTS,now}).reason,'price_cap');
 provider.close();
});
test('no hub orders falls back to CCP average, shares its large response and persists the cache',async()=>{
 let averageCalls=0;
 const prices=Array.from({length:15988},(_,i)=>({type_id:i+1,average_price:6,adjusted_price:99999}));
 const provider=quoteFixture(async url=>{
   if(url.includes('/prices/')){averageCalls++;await new Promise(resolve=>setTimeout(resolve,5));return response(prices);}
   return response([]);
 });
 const [a,b]=await Promise.all([provider.get(34,DEFAULTS),provider.get(35,DEFAULTS)]);
 assert.equal(averageCalls,1);assert.equal(a.orders,0);assert.equal(a.referencePrice,6);
 assert.equal(b.referenceKind,'eve_average');assert.equal(a.confidence,'high');
 const input={price:6,quantity:1,quote:a,config:DEFAULTS,now};
 assert.equal(evaluate(input).eligible,true);assert.equal(evaluate(input).referenceKind,'eve_average');
 assert.equal(evaluate({...input,price:8}).reason,'price_cap');
 assert.equal(evaluate({...input,now:now+3601000}).reason,'stale_quote');
 assert.equal(evaluate({...input,config:{...DEFAULTS,ironMode:false}}).reason,'demand_limit');
 await provider.get(34,DEFAULTS);assert.equal(averageCalls,1);provider.close();
});
test('missing or invalid averages never use adjusted industry prices or invent a fair price',async()=>{
 for(const average_price of [undefined,0,-1,NaN,Infinity,'6']){
   const provider=quoteFixture(async url=>response(url.includes('/prices/')?[{type_id:34,average_price,adjusted_price:6}]:[]));
   const q=await provider.get(34,DEFAULTS);
   assert.equal(q.referencePrice,null);assert.equal(evaluate({price:6,quantity:1,quote:q,config:DEFAULTS,now}).reason,'missing_quote');
   provider.close();
 }
});
test('selected EVE average bypasses hub orders, preserves independent caches and retains price rules',async()=>{
 const urls=[];
 const provider=quoteFixture(async url=>{urls.push(url);return response(url.includes('/prices/')?[{type_id:34,average_price:20,adjusted_price:1}]:
   url.includes('/orders/')?[{type_id:34,is_buy_order:false,location_id:60003760,price:6,volume_remain:100}]:[{date:'2026-10-08',average:6,volume:7000}]);});
 const averageConfig={...DEFAULTS,useEveAveragePrices:true};
 const a=await provider.get(34,averageConfig);
 assert.equal(a.referencePrice,20);assert.equal(a.referenceKind,'eve_average');assert.equal(urls.length,1);assert.ok(urls[0].includes('/prices/'));
 assert.equal(provider.peek(34,DEFAULTS),null);
 const hub=await provider.get(34,DEFAULTS);
 assert.equal(hub.referencePrice,6);assert.equal(hub.referenceKind,'hub_orders');
 assert.equal(provider.peek(34,averageConfig).referencePrice,20);
 const input={price:20,quantity:1,quote:a,config:averageConfig,now};
 assert.equal(evaluate(input).chancePercent,35);assert.equal(evaluate({...input,price:26}).reason,'price_cap');
 assert.equal(evaluate({...input,now:now+3601000}).reason,'stale_quote');
 assert.equal(evaluate({...input,quote:null}).reason,'missing_average');
 const missing=quoteFixture(async()=>response([{type_id:34,adjusted_price:20}]));
 assert.equal(evaluate({...input,quote:await missing.get(34,averageConfig)}).reason,'missing_average');missing.close();
 provider.close();
});
test('implausible existing hub orders fall back to the average without displaying the rejected ask',async()=>{
 const provider=quoteFixture(async url=>response(url.includes('/orders/')?[{type_id:34,is_buy_order:false,location_id:60003760,price:600,volume_remain:1}]:
   url.includes('/prices/')?[{type_id:34,average_price:6}]:[{date:'2026-10-08',average:6,volume:7000}]));
 const q=await provider.get(34,DEFAULTS);
 assert.equal(q.referenceKind,'eve_average');assert.equal(q.confidence,'high');assert.equal(q.referencePrice,6);
 assert.equal(q.rejectedHubPrice,600);
 assert.equal(evaluate({price:600,quantity:1,quote:q,config:DEFAULTS,now}).reason,'price_cap');provider.close();
});
test("provider coalesces concurrent quotes, persists response caching and honors 429 backoff",async()=>{
 const memory=new Map(),store={getHTTP:k=>memory.get(k),saveHTTP:(k,v)=>memory.set(k,v),getQuote:k=>memory.get("q:"+k),saveQuote:(k,v)=>memory.set("q:"+k,v)};
 let calls=0,time=now;
 const fetchImpl=async url=>{calls++;const history=url.includes("/history/");return {status:200,ok:true,headers:new Headers({expires:new Date(time+300000).toUTCString(),etag:'"a"'}),json:async()=>history?[{date:"2026-10-08",average:6,volume:700000}]:[{type_id:34,is_buy_order:false,location_id:60003760,price:6,volume_remain:1000},{type_id:34,is_buy_order:false,location_id:60003760,price:6.1,volume_remain:1000}]};};
 const provider=createQuoteProvider({store,fetchImpl,clock:()=>time});
 const values=await Promise.all([provider.get(34,DEFAULTS),provider.get(34,DEFAULTS)]);assert.equal(calls,2);assert.equal(values[0].confidence,"high");
 await provider.get(34,DEFAULTS);assert.equal(calls,2);provider.close();
 const limited=createQuoteProvider({store:{getHTTP:()=>null,saveHTTP(){},getQuote:()=>null,saveQuote(){}},clock:()=>time,fetchImpl:async()=>({status:429,ok:false,headers:new Headers({"retry-after":"120"})})});
 const missing=await limited.get(34,DEFAULTS);assert.equal(missing.confidence,"unavailable");assert.equal(limited.status().nextRequestAt,time+120000);limited.close();
});
