"use strict";

// A compact, permanent accounting ledger. Activity is presentation, never the
// source of financial totals. Unique operation keys also cover saga recovery.
const DAY=86400000;
const cents=value=>Math.round(Number(value)*100);
function createStatistics(db){
  db.exec(`CREATE TABLE IF NOT EXISTS nm_sales(
    operation_key TEXT PRIMARY KEY, seller_id INTEGER NOT NULL, order_id TEXT NOT NULL,
    type_id INTEGER NOT NULL, quantity INTEGER NOT NULL, gross_cents INTEGER NOT NULL,
    tax_cents INTEGER, occurred_at INTEGER NOT NULL, settled_at INTEGER NOT NULL,
    offline INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS nm_sales_time ON nm_sales(seller_id,occurred_at);
    CREATE INDEX IF NOT EXISTS nm_sales_order ON nm_sales(seller_id,order_id);
    CREATE TABLE IF NOT EXISTS nm_sales_daily(seller_id INTEGER NOT NULL,day INTEGER NOT NULL,
      type_id INTEGER NOT NULL,offline INTEGER NOT NULL,purchases INTEGER NOT NULL,
      units INTEGER NOT NULL,gross INTEGER NOT NULL,tax INTEGER NOT NULL,unknownTax INTEGER NOT NULL,
      PRIMARY KEY(seller_id,day,type_id,offline));`);
  if(!db.prepare("SELECT 1 FROM nm_meta WHERE key='salesDailyV1'").get())db.transaction(()=>{
    db.exec(`INSERT OR REPLACE INTO nm_sales_daily SELECT seller_id,CAST(occurred_at/86400000 AS INTEGER),
      type_id,offline,COUNT(*),SUM(quantity),SUM(gross_cents),COALESCE(SUM(tax_cents),0),
      SUM(CASE WHEN tax_cents IS NULL THEN 1 ELSE 0 END) FROM nm_sales GROUP BY 1,2,3,4;
      INSERT INTO nm_meta VALUES('salesDailyV1','true');`);
  })();
  const insert=db.prepare('INSERT OR IGNORE INTO nm_sales VALUES(?,?,?,?,?,?,?,?,?,?)');
  const daily=db.prepare(`INSERT INTO nm_sales_daily VALUES(?,?,?,?,1,?,?,?,?)
    ON CONFLICT(seller_id,day,type_id,offline) DO UPDATE SET purchases=purchases+1,
    units=units+excluded.units,gross=gross+excluded.gross,tax=tax+excluded.tax,unknownTax=unknownTax+excluded.unknownTax`);
  const record=db.transaction((op,result)=>{
    if(op.state!=='settled'||result.state!=='settled')return;
    const order=JSON.parse(op.order_json),tax=result.taxISK==null?null:cents(result.taxISK);
    const at=op.activity_at??op.updated_at,offline=op.offline_purchase?1:0;
    if(insert.run(op.operation_key,op.seller_id,String(order.orderID),op.type_id,op.quantity,
      op.cost_cents,tax,at,op.updated_at,offline).changes)
      daily.run(op.seller_id,Math.floor(at/DAY),op.type_id,offline,op.quantity,op.cost_cents,tax??0,tax===null?1:0);
  });
  // One-time migration reads durable receipts, including purchases which the
  // old 5,000-row Activity limit already removed. It never modifies receipts.
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='nm_operations'").get()&&
      !db.prepare("SELECT 1 FROM nm_meta WHERE key='salesLedgerV1'").get()){
    db.transaction(()=>{
      let after='';
      for(;;){
        const rows=db.prepare("SELECT * FROM nm_operations WHERE state='settled' AND operation_key>? ORDER BY operation_key LIMIT 1000").all(after);
        if(!rows.length)break;
        for(const op of rows)record(op,JSON.parse(op.result_json||'{}'));
        after=rows.at(-1).operation_key;
      }
      db.prepare("INSERT OR IGNORE INTO nm_meta VALUES('salesLedgerV1','true')").run();
    })();
  }
  function activeOrders(sellerID,orders){
    let sold=0,remaining=0;
    for(let i=0;i<orders.length;i+=400){
      const ids=orders.slice(i,i+400).map(o=>String(o.orderID));
      sold+=db.prepare(`SELECT COALESCE(SUM(gross_cents),0) n FROM nm_sales
        WHERE seller_id=? AND order_id IN (${ids.map(()=>'?').join(',')})`).get(sellerID,...ids).n;
    }
    for(const order of orders)remaining+=cents(Number(order.price)*Number(order.quantity));
    return {activeCount:orders.length,soldISK:sold/100,remainingISK:remaining/100,totalISK:(sold+remaining)/100};
  }
  const sums=`COUNT(*) purchases,COALESCE(SUM(quantity),0) units,
    COALESCE(SUM(gross_cents),0) gross,COALESCE(SUM(tax_cents),0) tax,
    COALESCE(SUM(CASE WHEN tax_cents IS NULL THEN 1 ELSE 0 END),0) unknownTax`;
  const money=row=>({purchases:row.purchases,units:row.units,grossISK:row.gross/100,
    taxISK:row.tax/100,netISK:(row.gross-row.tax)/100,unknownTax:row.unknownTax});
  function get(sellerID,{days=null}={},now=Date.now()){
    if(days!==null&&(!Number.isSafeInteger(days)||days<1||days>36500))throw Error('Days must be a whole number from 1 to 36500');
    const first=db.prepare('SELECT MIN(occurred_at) first FROM nm_sales WHERE seller_id=?').get(sellerID).first;
    const since=days===null?(first??now):now-days*DAY;
    const span=Math.max(1,Math.ceil((now-since)/DAY)),bucketDays=Math.max(1,Math.ceil(span/60));
    const bucketMs=bucketDays*DAY,origin=Math.floor(since/DAY)*DAY;
    const fullStart=Math.ceil(since/DAY)*DAY,fullEnd=Math.floor(now/DAY)*DAY;
    let rows=[];
    const edge=(from,to)=>from>to?[]:db.prepare(`SELECT CAST(occurred_at/86400000 AS INTEGER) day,
      type_id,offline,${sums} FROM nm_sales WHERE seller_id=? AND occurred_at>=? AND occurred_at<=?
      GROUP BY day,type_id,offline`).all(sellerID,from,to);
    if(fullStart>=fullEnd)rows=edge(since,now);
    else{
      rows=db.prepare('SELECT * FROM nm_sales_daily WHERE seller_id=? AND day>=? AND day<?').all(sellerID,fullStart/DAY,fullEnd/DAY);
      rows.push(...edge(since,fullStart-1),...edge(fullEnd,now));
    }
    const empty=()=>({purchases:0,units:0,gross:0,tax:0,unknownTax:0});
    const total=empty(),byBucket=new Map(),items=new Map(),sourceTotals=new Map();
    const add=(target,row)=>{for(const key of Object.keys(target))target[key]+=row[key];};
    for(const row of rows){
      const bucket=Math.floor((row.day*DAY-origin)/bucketMs);
      if(!byBucket.has(bucket))byBucket.set(bucket,empty());
      if(!items.has(row.type_id))items.set(row.type_id,empty());
      if(!sourceTotals.has(row.offline))sourceTotals.set(row.offline,empty());
      for(const target of [total,byBucket.get(bucket),items.get(row.type_id),sourceTotals.get(row.offline)])add(target,row);
    }
    const totals=money(total);
    const buckets=[];
    for(let at=origin,index=0;at<=now;at+=bucketMs,index++)buckets.push({at,...money(byBucket.get(index)||empty())});
    const topItems=[...items].sort((a,b)=>b[1].gross-a[1].gross||a[0]-b[0]).slice(0,6).map(([typeID,row])=>({typeID,...money(row)}));
    const sources=[...sourceTotals].sort((a,b)=>a[0]-b[0]).map(([offline,row])=>({offline:Boolean(offline),...money(row)}));
    return {days,since,until:now,firstSaleAt:first,bucketDays,buckets,totals,topItems,sources,
      averageDailyNetISK:totals.netISK/span};
  }
  return {record,activeOrders,get};
}
module.exports={createStatistics};
