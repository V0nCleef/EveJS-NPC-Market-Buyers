'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require(path.join(process.env.EVEJS_TEST_ROOT||path.resolve(__dirname,'../../EveJS-v0.12.9'),'server/node_modules/better-sqlite3'));
const {createStore}=require('../lib/store'),{createEngine}=require('../lib/engine'),{evaluate}=require('../lib/policy');
const {installService}=require('../lib/service');
const DAY=86400000,now=Date.UTC(2026,9,10,16),seller=42;
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nmb-statistics-')),file=path.join(dir,'mod.sqlite');
 let store=createStore(file,{Database});
 t.after(()=>{store.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 return {get store(){return store;},reopen(){store.close();store=createStore(file,{Database});return store;}};
}
function sale(store,key,{at=now,owner=seller,id='9',gross=100,tax=8,qty=10,offline=false,type=34}={}){
 const op={operation_key:key,seller_id:owner,order_json:JSON.stringify({orderID:id,price:gross/qty}),type_id:type,
  quantity:qty,cost_cents:Math.round(gross*100),state:'settled',activity_at:at,updated_at:now,offline_purchase:offline?1:0};
 store.statistics.record(op,{state:'settled',taxISK:tax});return op;
}
test('active order values use actual receipts after price changes and exclude closed/other-seller orders',t=>{
 const {store}=fixture(t);sale(store,'a');sale(store,'a');sale(store,'b',{id:'closed',gross:999});sale(store,'c',{owner:43,gross:999});
 assert.deepEqual(store.statistics.activeOrders(42,[{orderID:9,price:12,quantity:90}]),{
  activeCount:1,soldISK:100,remainingISK:1080,totalISK:1180});
 assert.deepEqual(store.statistics.activeOrders(42,[]),{activeCount:0,soldISK:0,remainingISK:0,totalISK:0});
});
test('all-time and arbitrary days include archived sales, zero days in graphs and simulated offline dates',t=>{
 const {store}=fixture(t);sale(store,'a',{at:now-80*DAY});sale(store,'b',{at:now-2*DAY,gross:200,tax:16,offline:true});
 sale(store,'c',{at:now+DAY,gross:999});sale(store,'d',{owner:43,gross:999});
 let stats=store.statistics.get(42,{},now);
 assert.deepEqual(stats.totals,{purchases:2,units:20,grossISK:300,taxISK:24,netISK:276,unknownTax:0});
 assert.ok(stats.buckets.length<=61);assert.equal(stats.buckets.reduce((n,r)=>n+r.netISK,0),276);
 stats=store.statistics.get(42,{days:3},now);assert.equal(stats.totals.netISK,184);assert.equal(stats.sources[0].offline,true);
 assert.equal(stats.buckets.filter(b=>b.purchases===0).length,3);
 for(const days of [0,-1,1.5,'7',36501])assert.throws(()=>store.statistics.get(42,{days},now),/Days/);
 assert.equal(store.statistics.get(77,{},now).totals.purchases,0);
});
test('Activity archives after age or 500 rows, pages through tied timestamps, retains every row across restart',t=>{
 const f=fixture(t),store=f.store;
 store.db.transaction(()=>{for(let i=0;i<650;i++)store.recordActivity({kind:'configuration',message:'test',characterID:42,timestamp:now,operationKey:'e'+i});
 store.recordActivity({kind:'purchase',message:'old',characterID:42,timestamp:now-31*DAY});
 store.recordActivity({kind:'purchase',message:'other',characterID:43,timestamp:now});})();
 let page=store.activityPage(42,{now});assert.equal(page.recentCount,500);assert.equal(page.archiveCount,151);assert.equal(page.activity.length,100);
 const ids=new Set();let cursor=null;
 do{page=store.activityPage(42,{now,scope:'archive',cursor});for(const row of page.activity){assert.ok(!ids.has(row.id));ids.add(row.id);}cursor=page.nextCursor;}while(cursor);
 assert.equal(ids.size,151);f.reopen();assert.equal(f.store.activityPage(42,{now}).total,651);
 assert.throws(()=>f.store.activityPage(42,{scope:'garbage'}),/scope/);
});

test('daily aggregates preserve exact rolling boundaries and unknown-tax warnings',t=>{
 const {store}=fixture(t),since=now-3*DAY;
 for(const [key,at] of [['excluded-before',since-1],['first',since],['whole-day',now-DAY],['last',now],['excluded-after',now+1]])
  sale(store,key,{at,tax:key==='whole-day'?null:8});
 const data=store.statistics.get(42,{days:3},now);
 assert.deepEqual(data.totals,{purchases:3,units:30,grossISK:300,taxISK:16,netISK:284,unknownTax:1});
 assert.equal(data.buckets.reduce((sum,row)=>sum+row.grossISK,0),300);
});
test('migration recovers sales whose activity was deleted, with no double count on further restarts',t=>{
 const f=fixture(t),store=f.store;
 const engine=createEngine({adapter:{},quotes:{},store,getConfig:store.getConfig,evaluate});
 const op=sale(store,'legacy',{at:now-45*DAY});
 store.db.prepare('DELETE FROM nm_sales').run();
 store.db.prepare('DELETE FROM nm_sales_daily').run();
 store.db.prepare(`INSERT INTO nm_operations(operation_key,cycle_id,group_key,day,seller_id,type_id,quantity,cost_cents,state,order_json,result_json,created_at,updated_at,activity_at,offline_purchase)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(op.operation_key,'1','1','2026-08-26',42,34,10,10000,'settled',op.order_json,JSON.stringify({state:'settled',taxISK:8}),op.activity_at,now,op.activity_at,0);
 f.reopen();assert.equal(f.store.statistics.get(42,{},now).totals.netISK,92);f.reopen();assert.equal(f.store.statistics.get(42,{},now).totals.purchases,1);
});
test('scale: 100,000 sales stay complete while Activity and RPC pages are bounded',async t=>{
 const f=fixture(t),store=f.store,start=performance.now();
 store.db.transaction(()=>{for(let i=0;i<100000;i++){
  sale(store,'scale'+i,{at:now-(i%100)*DAY,gross:1.11,tax:.09,type:34+i%7});
  store.recordActivity({kind:'purchase',message:'scale',characterID:42,operationKey:'scale'+i,timestamp:now-(i%100)*DAY});
 }})();
 const at=performance.now(),stats=store.statistics.get(42,{},now),page=store.activityPage(42,{now});
 assert.equal(stats.totals.netISK,102000);assert.equal(stats.totals.purchases,100000);
 assert.equal(page.activity.length,100);assert.equal(page.recentCount,500);assert.equal(page.archiveCount,99500);
 assert.ok(stats.buckets.length<=61);assert.ok(stats.topItems.length<=6);
 class Service{};installService(Service,{store,quotes:{get:async()=>{},peek:()=>null},engine:{status:()=>({}),previewAllowance:()=>({})},adapter:{ready:async()=>{},listOrders:async()=>[]},hasStaffAccountRole:()=>false,clock:()=>now});
 const service=new Service();const response=JSON.parse(await service.Handle_NpcMarketStatistics(['{"days":17}'],{charid:42}));
 assert.equal(response.success,true);assert.equal(response.statistics.totals.purchases,18000);
 const other=JSON.parse(await service.Handle_NpcMarketStatistics(['{"days":null,"sellerID":42}'],{charid:43}));assert.equal(other.statistics.totals.purchases,0);
 t.diagnostic(JSON.stringify({rows:100000,seedMs:Math.round(at-start),queryMs:Math.round(performance.now()-at),responseBytes:Buffer.byteLength(JSON.stringify(response))}));
});
