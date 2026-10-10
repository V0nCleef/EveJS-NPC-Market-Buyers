'use strict';
const path=require('node:path');
const tree='G:\\Eve Local\\Codex playground\\EveJS-v0.12.9';
module.exports=async function(args,session){
   if(Number(session.charid||session.characterID)!==140000006)throw Error('Wrong test character');
   const runtime=globalThis[Symbol.for('evejs.npc-market-buyers.loader.v1')].runtime;
   if(runtime.store.db.name!==path.join(tree,'_local/npc-market-buyers/state.sqlite'))throw Error('Test database mismatch');
   const {store,adapter}=runtime,now=Date.now(),id=140000006,stationID=Number(session.stationid||session.stationID);
   if(store.db.prepare("SELECT 1 FROM nm_operations WHERE operation_key LIKE 'npc-market:gridcheck-actual:%' LIMIT 1").get())
     throw Error('Fixture already seeded; preserve this world or restore a clean isolated world before seeding again');
   const wallet=require(path.join(tree,'server/src/services/account/walletState'));
   const items=require(path.join(tree,'server/src/services/inventory/itemStore'));
   const credit=await wallet.adjustCharacterBalanceAsync(id,1000000000,{description:'GridCheck test funds'});
   if(credit.success===false)throw Error('Test wallet funding failed');
   const definitions=[[34,1000000,6.5],[35,850000,9.8],[36,620000,76],[37,250000,930],[38,180000,720],
    [39,95000,1850],[40,65000,4200],[241,420,950],[178,200000,12],[16633,50000,2100]];
   const seeded=[];
   for(const [typeID,quantity,price] of definitions){
    const grant=items.grantItemToCharacterStationHangar(id,stationID,typeID,quantity);
    if(!grant.success)throw Error('Test inventory grant failed');
    const item=grant.data.items?grant.data.items[0]:grant.data;
    const placed=await this.Handle_PlaceMultiSellOrder([[{itemID:item.itemID,typeID,stationID,quantity,price}],false,30],session);
    if(!placed)throw Error('Test order placement failed');
    const order=(await adapter.listOrders()).filter(o=>Number(o.sellerID)===id&&o.typeID===typeID).at(-1);
    const key='npc-market:gridcheck-actual:'+order.orderID;
    const purchased=Math.max(1,Math.floor(quantity*(.10+seeded.length*.035)));
    const op={operation_key:key,cycle_id:'test:'+order.orderID,group_key:'test:'+order.orderID,
     day:new Date(now).toISOString().slice(0,10),seller_id:id,type_id:typeID,quantity:purchased,cost_cents:Math.round(purchased*price*100),
     state:'pending',order_json:JSON.stringify(order),created_at:now,updated_at:now,activity_at:now,offline_purchase:0};
    store.db.prepare(`INSERT INTO nm_operations(operation_key,cycle_id,group_key,day,seller_id,type_id,quantity,cost_cents,state,order_json,created_at,updated_at,activity_at,offline_purchase)
      VALUES(@operation_key,@cycle_id,@group_key,@day,@seller_id,@type_id,@quantity,@cost_cents,@state,@order_json,@created_at,@updated_at,@activity_at,@offline_purchase)`).run(op);
    const receipt=await adapter.buy(order,purchased,key);
    store.db.transaction(()=>{
      store.db.prepare("UPDATE nm_operations SET state='settled',result_json=? WHERE operation_key=?").run(JSON.stringify(receipt),key);
      store.statistics.record({...op,state:'settled'},receipt);
      store.recordActivity({characterID:id,kind:'purchase',operationKey:key,timestamp:now,
       message:'GridCheck actual purchase',details:{...receipt,typeID,orderID:order.orderID,stationID}});
    })();
    seeded.push({orderID:order.orderID,quantity:purchased,grossISK:receipt.grossISK,taxISK:receipt.taxISK});
   }
   // Invented closed-order history, spanning ninety days; never credits money
   // or creates inventory. Separate from the real settlement checks above.
   store.db.transaction(()=>{
    for(let i=0;i<12000;i++){
     const day=i%90,at=now-day*86400000-(i%96)*900000;
     const [typeID,,price]=definitions[i%definitions.length];
     const quantity=100+(i*73)%8500,gross=quantity*price,tax=Math.round(gross*8)/100;
     const key='gridcheck-synthetic:'+i;
     store.statistics.record({operation_key:key,seller_id:id,order_json:JSON.stringify({orderID:'archived-test-'+i}),type_id:typeID,
      quantity,cost_cents:Math.round(gross*100),state:'settled',activity_at:at,updated_at:now,offline_purchase:i%3===0?1:0},{state:'settled',taxISK:tax});
     store.recordActivity({characterID:id,kind:'purchase',operationKey:key,timestamp:at,message:'Synthetic test history',
      details:{typeID,quantity,grossISK:gross,taxISK:tax,orderID:'archived-test-'+i,offlinePurchase:i%3===0,settledAt:now}});
    }
    store.db.prepare("INSERT OR REPLACE INTO nm_engine_meta VALUES('nextDueAt',?)").run(JSON.stringify(now+86400000));
   })();
   return JSON.stringify({success:true,realPurchases:seeded,syntheticHistory:12000,statistics:store.statistics.get(id,{},now)});
};
