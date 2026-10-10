"use strict";

// All bookkeeping belongs to the mod DB. Money is stored in integer cents;
// pending settlements count against every limit until explicitly reconciled.
const {batchQuantity}=require('./policy');
const {BUY_INTERVAL_SECONDS}=require('./config');
const {createHash}=require('node:crypto');
function createEngine({adapter, quotes, store, getConfig, evaluate, clock = Date.now,
  random = Math.random, log = console, walletBatching = null,
  yieldControl = () => new Promise(resolve=>setTimeout(resolve,5))}) {
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS nm_engine_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS nm_draws (cycle_id TEXT NOT NULL, group_key TEXT NOT NULL,
      draw REAL NOT NULL, chance REAL NOT NULL, PRIMARY KEY(cycle_id,group_key));
    CREATE TABLE IF NOT EXISTS nm_operations (operation_key TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL, group_key TEXT NOT NULL, day TEXT NOT NULL,
      seller_id INTEGER NOT NULL, type_id INTEGER NOT NULL, quantity INTEGER NOT NULL,
      cost_cents INTEGER NOT NULL, state TEXT NOT NULL, order_json TEXT NOT NULL,
      result_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(cycle_id,group_key));
    CREATE INDEX IF NOT EXISTS nm_operations_limits ON nm_operations(day,state,seller_id,type_id);`);
  let timer = null, running = false, busy = null, lastError = null;
  if(!db.prepare('PRAGMA table_info(nm_draws)').all().some(column=>column.name==='batch_draw'))
    db.exec('ALTER TABLE nm_draws ADD COLUMN batch_draw REAL');
  const operationColumns=db.prepare('PRAGMA table_info(nm_operations)').all();
  if(!operationColumns.some(column=>column.name==='activity_at'))db.exec('ALTER TABLE nm_operations ADD COLUMN activity_at INTEGER');
  if(!operationColumns.some(column=>column.name==='offline_purchase'))db.exec('ALTER TABLE nm_operations ADD COLUMN offline_purchase INTEGER NOT NULL DEFAULT 0');
  const now = () => Number(clock());
  const meta = key => { const row = db.prepare('SELECT value FROM nm_engine_meta WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; };
  const put = (key,value) => db.prepare('INSERT INTO nm_engine_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
  const cents = value => Math.floor((Number(value) + 1e-8) * 100);
  const dayOf = ts => new Date(ts).toISOString().slice(0,10);
  const activity = value => { if (store.recordActivity) store.recordActivity(value); };
  function totals(day, extra = '', values = []) {
    return db.prepare(`SELECT COALESCE(SUM(cost_cents),0) AS cents,
      COALESCE(SUM(quantity),0) AS quantity FROM nm_operations
      WHERE day=? AND state IN ('pending','settled') ${extra}`).get(day,...values);
  }
  function status() {
    const current = now(), day = dayOf(current);
    const config=getConfig(),due=meta('nextDueAt');
    return {running, busy: Boolean(busy), lastDueAt: meta('lastDueAt'), nextDueAt: meta('nextDueAt'),
      catchingUp:Boolean(config.offlinePurchases&&config.enabled&&due!=null&&due<=current),
      lastCompletedAt: meta('lastCompletedAt'), lastError,settlement:adapter.status?adapter.status():null,
      spentTodayISK: totals(day).cents / 100,
      pending: db.prepare("SELECT COUNT(*) AS n FROM nm_operations WHERE state='pending'").get().n,
      purchasedToday: db.prepare("SELECT COALESCE(SUM(quantity),0) AS n FROM nm_operations WHERE day=? AND state='settled'").get(day).n};
  }
  function previewAllowance({sellerID,typeID,price,stationID,quantity}) {
    const config=getConfig(),day=dayOf(now()),due=String(meta('nextDueAt'));
    if(config.ironMode)return {unlimited:true,availableISK:null,remainingDemand:null,maxAffordableQuantity:null,
      purchasedTypeToday:totals(day,'AND type_id=?',[typeID]).quantity};
    const availableCents=Math.max(0,Math.min(cents(config.dailyBudgetISK)-totals(day).cents,
      cents(config.sellerDailyBudgetISK)-totals(day,'AND seller_id=?',[sellerID]).cents,
      cents(config.cycleBudgetISK)-totals(day,'AND cycle_id=?',[due]).cents));
    const cached=quotes.peek?quotes.peek(typeID,config,{stationID,quantity}):null;
    const remainingDemand=cached?Math.max(0,Math.floor(Number(cached.dailyVolume||0)*config.tqDailyVolumePercent/100)-totals(day,'AND type_id=?',[typeID]).quantity):undefined;
    return {availableISK:availableCents/100,remainingDemand,purchasedTypeToday:totals(day,'AND type_id=?',[typeID]).quantity,
      maxAffordableQuantity:price>0?Math.floor(availableCents/Math.max(1,cents(price))):0};
  }
  async function settle(op) {
    const order = JSON.parse(op.order_json);
    // Include the final current-time check in an already open catch-up batch.
    // Ordinary live checks with no backlog still announce their native legs.
    const bundled=Boolean(op.offline_purchase||walletBatching?.activeBatch());
    walletBatching?.tagOperation(op.operation_key,bundled);
    try {
      const result = await adapter.buy(order, op.quantity, op.operation_key);
      if (!result || result.state !== 'settled' || result.quantity !== op.quantity ||
          cents(result.grossISK) !== op.cost_cents) {
        const error = new Error('Settlement has no matching committed receipt');
        error.outcomeUnknown = true;
        throw error;
      }
      db.prepare("UPDATE nm_operations SET state='settled',result_json=?,updated_at=? WHERE operation_key=?").run(JSON.stringify(result),now(),op.operation_key);
      const settledAt=now();
      activity({kind:'purchase', characterID:op.seller_id, operationKey:op.operation_key,
        timestamp:op.activity_at??settledAt, message:`NPC bought ${op.quantity} units for ${(op.cost_cents/100).toFixed(2)} ISK.`,
        details:{...result, orderID:order.orderID, typeID:op.type_id, stationID:order.stationID,
          offlinePurchase:Boolean(op.offline_purchase),scheduledAt:op.activity_at??settledAt,settledAt}});
    } catch (error) {
      const definitive = error && error.definitive === true;
      db.prepare('UPDATE nm_operations SET state=?,result_json=?,updated_at=? WHERE operation_key=?').run(
        definitive ? 'rejected' : 'pending', JSON.stringify({error:String(error.message || error)}),now(),op.operation_key);
      activity({kind:definitive?'rejected':'recovery',characterID:op.seller_id,
        operationKey:`${op.operation_key}:${definitive?'rejected':'pending'}`,timestamp:now(),
        message:String(error.message || error),details:{operationKey:op.operation_key}});
      if (!definitive) throw error;
    } finally {
      // A backlog must not monopolize the main event loop between completed
      // sagas. Never yield halfway through a financial/custody transaction.
      if(bundled)await yieldControl();
    }
  }
  async function recover() {
    for(const op of db.prepare("SELECT operation_key FROM nm_operations WHERE state='pending' AND offline_purchase=1").all())
      walletBatching?.tagOperation(op.operation_key,true);
    if (adapter.recover) await adapter.recover();
    for (const op of db.prepare("SELECT * FROM nm_operations WHERE state='pending' ORDER BY created_at,operation_key").all()) await settle(op);
  }
  async function cycle() {
    const config = getConfig(), started = now();
    // Recovery precedes fresh work. Unknown outcomes never get a fresh draw.
    if(config.enabled || db.prepare("SELECT 1 FROM nm_operations WHERE state='pending' LIMIT 1").get()) await recover();
    if (!config.enabled) {
      // Explicitly paused time never builds an offline-purchase backlog.
      put('nextDueAt',started+BUY_INTERVAL_SECONDS*1000);
      return status();
    }
    let dueAt = meta('nextDueAt');
    if (dueAt == null) { dueAt = started + BUY_INTERVAL_SECONDS*1000; put('nextDueAt',dueAt); }
    if (started < dueAt) return status();
    const cycleID = String(dueAt), day = dayOf(started);
    put('lastDueAt',dueAt);
    const groups = new Map();
    let firstNewOrderCheck=Infinity;
    for (const order of await adapter.listOrders()) {
      if (order.source !== 'player' || order.reason || !Number.isSafeInteger(order.sellerID) ||
          !Number.isSafeInteger(order.typeID) || !Number.isSafeInteger(order.stationID) ||
          !Number.isSafeInteger(order.quantity) || order.quantity<=0 || !(order.price>0)) continue;
      // A newly listed item never receives checks from before it was listed.
      const issued=Date.parse(order.issuedAt),expires=Date.parse(order.expiresAt);
      if(Number.isFinite(expires)&&expires<=started)continue;
      if(config.offlinePurchases&&Number.isFinite(issued)&&issued>dueAt){
        firstNewOrderCheck=Math.min(firstNewOrderCheck,dueAt+Math.ceil((issued-dueAt)/(BUY_INTERVAL_SECONDS*1000))*BUY_INTERVAL_SECONDS*1000);
        continue;
      }
      const key = `${order.sellerID}:${order.typeID}:${order.stationID}`;
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(order);
    }
    let hadEligibleOrder=false,checked=0;
    for (const [key, orders] of [...groups].sort((a,b)=>a[0].localeCompare(b[0]))) {
      if(config.offlinePurchases&&dueAt<started-60000&&++checked%25===0)await yieldControl();
      // One operation per seller/type/station in a cycle: splitting, repricing,
      // relisting and retrying cannot create more lottery tickets.
      if (db.prepare('SELECT 1 FROM nm_operations WHERE cycle_id=? AND group_key=?').get(cycleID,key)) {hadEligibleOrder=true;continue;}
      orders.sort((a,b)=>a.price-b.price || String(a.orderID).localeCompare(String(b.orderID),undefined,{numeric:true}));
      const order = orders[0];
      const quote = await quotes.get(order.typeID,config,order);
      const availableCents = config.ironMode?Number.MAX_SAFE_INTEGER:Math.max(0,Math.min(cents(config.dailyBudgetISK)-totals(day).cents,
        cents(config.sellerDailyBudgetISK)-totals(day,'AND seller_id=?',[order.sellerID]).cents,
        cents(config.cycleBudgetISK)-totals(day,'AND cycle_id=?',[cycleID]).cents));
      const volumeLeft = config.ironMode?Number.MAX_SAFE_INTEGER:Math.max(0,Math.floor(Number(quote && quote.dailyVolume || 0)*config.tqDailyVolumePercent/100)-totals(day,'AND type_id=?',[order.typeID]).quantity);
      const groupedQuantity=orders.reduce((sum,item)=>Math.min(Number.MAX_SAFE_INTEGER,sum+item.quantity),0);
      const preview=evaluate({price:order.price,quantity:groupedQuantity,quote,config,now:started,availableISK:availableCents/100,remainingDemand:volumeLeft});
      if(preview.eligible)hadEligibleOrder=true;
      let draw=db.prepare('SELECT draw,chance,batch_draw FROM nm_draws WHERE cycle_id=? AND group_key=?').get(cycleID,key);
      if (!draw) {
        const sample=Number(random());
        if (!Number.isFinite(sample) || sample<0 || sample>=1) throw new Error('Invalid random sample');
        const batchDraw=config.randomBatch?Number(random()):0;
        if(!Number.isFinite(batchDraw)||batchDraw<0||batchDraw>=1)throw Error('Invalid batch random sample');
        draw={draw:sample*100,chance:Number(preview.chancePercent)||0,batch_draw:batchDraw};
        db.prepare('INSERT INTO nm_draws(cycle_id,group_key,draw,chance,batch_draw) VALUES (?,?,?,?,?)').run(cycleID,key,draw.draw,draw.chance,draw.batch_draw);
      }
      // Eligibility is rechecked; the persisted probability can only go down.
      if (!preview.eligible || draw.draw >= Math.min(draw.chance,preview.chancePercent)) continue;
      const maximum=Math.min(order.quantity,Math.max(1,Math.floor(groupedQuantity*config.batchPercent/100)),
        Math.floor(availableCents/Math.max(1,cents(order.price))),volumeLeft,
        Number.isSafeInteger(preview.maxQuantity)?preview.maxQuantity:0);
      // Existing 0.1.1 draws keep their original fixed maximum. New draws store
      // the size sample alongside the chance, so a retry/restart never rerolls.
      const quantity=draw.batch_draw===null?maximum:batchQuantity({quantity:groupedQuantity,config,draw:draw.batch_draw,cap:maximum});
      if (quantity<1) continue;
      const cost=cents(order.price*quantity);
      if (!Number.isSafeInteger(cost) || cost>availableCents) continue;
      const operationKey=`npc-market:${cycleID}:${key}`;
      const offlinePurchase=Boolean(config.offlinePurchases&&dueAt<started-60000);
      // Simulated history is spread inside the missed interval. Derive the
      // offset from the durable operation identity without consuming/rerolling
      // purchase samples. Real wallet/receipt settlement timestamps stay real.
      const spread=Math.max(0,Math.min(BUY_INTERVAL_SECONDS*1000-1,started-dueAt));
      const activityAt=offlinePurchase?dueAt+createHash('sha256').update(operationKey).digest().readUInt32LE(0)%(spread+1):started;
      db.prepare(`INSERT INTO nm_operations(operation_key,cycle_id,group_key,day,seller_id,type_id,quantity,
        cost_cents,state,order_json,result_json,created_at,updated_at,activity_at,offline_purchase)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(operationKey,
        cycleID,key,day,order.sellerID,order.typeID,quantity,cost,'pending',JSON.stringify(order),null,started,started,activityAt,offlinePurchase?1:0);
      await settle(db.prepare('SELECT * FROM nm_operations WHERE operation_key=?').get(operationKey));
    }
    put('lastCompletedAt',now());
    // Optional catch-up consumes one durable check per scheduler pass. The
    // normal arm yields at least a second between passes. Empty/ineligible
    // markets skip redundant zero-chance history; paused time never accrues.
    const next=dueAt+BUY_INTERVAL_SECONDS*1000;
    const currentPolicy=getConfig();
    const changed=currentPolicy.enabled!==config.enabled||currentPolicy.offlinePurchases!==config.offlinePurchases;
    put('nextDueAt',changed?now()+BUY_INTERVAL_SECONDS*1000:
      config.offlinePurchases&&hadEligibleOrder?next:
      Math.max(next,Math.min(config.offlinePurchases?firstNewOrderCheck:Infinity,now()+BUY_INTERVAL_SECONDS*1000)));
    return status();
  }
  function runCycle() {
    if (busy) return busy;
    busy=cycle().then(result=>{
      const config=getConfig(),due=meta('nextDueAt');
      if(!config.enabled||!config.offlinePurchases||due==null||due>now())walletBatching?.finish();
      lastError=null;return result;
    }).catch(error=>{
      // Already committed income is still announced on an interrupted pass;
      // the durable batch/operation identity remains available for recovery.
      walletBatching?.flush();
      lastError=String(error.message||error);if(log && log.error)log.error(`[NPC Market Buyers] ${lastError}`);throw error;
    }).finally(()=>{busy=null;});
    return busy;
  }
  function arm() {
    if (!running) return;
    if (meta('nextDueAt')==null) put('nextDueAt',now()+BUY_INTERVAL_SECONDS*1000);
    const delay=lastError?15000:Math.min(60000,Math.max(1000,Number(meta('nextDueAt'))-now()));
    timer=setTimeout(()=>{timer=null;runCycle().catch(()=>{}).finally(arm);},delay);
    if(timer.unref)timer.unref();
  }
  function start(){if(running)return;running=true;if(adapter.ready)adapter.ready().catch(error=>{lastError=String(error.message||error);});arm();}
  function stop(){running=false;if(timer)clearTimeout(timer);timer=null;return (busy||Promise.resolve()).finally(()=>walletBatching?.flush());}
  return {start,stop,runCycle,status,previewAllowance};
}
module.exports={createEngine};
