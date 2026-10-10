"use strict";
const {AsyncLocalStorage}=require('node:async_hooks');
const crypto=require('node:crypto');
const MARKER='npc-market-buyers:institution:v1';

function createGate(timeoutMS=30000) {
  const context=new AsyncLocalStorage();let tail=Promise.resolve();
  function wrap(fn) { return async function(...args) {
    if(context.getStore()?.active)return fn.apply(this,args);
    let release;const turn=new Promise(resolve=>{release=resolve;});
    const previous=tail;tail=previous.then(()=>turn,()=>turn);
    let timeout;
    try { await Promise.race([previous,new Promise((_,reject)=>{
      timeout=setTimeout(()=>reject(Error('Market mutation queue timeout; retry later')),timeoutMS);
    })]); }
    catch(error){previous.finally(release);throw error;}
    finally{clearTimeout(timeout);}
    const lease={active:true};
    try{return await context.run(lease,()=>fn.apply(this,args));}finally{lease.active=false;release();}
  }; }
  return {wrap};
}
function definitive(message){const error=Error(message);error.definitive=true;return error;}
function money(value){return Math.round(Number(value)*100);}
function createNativeBridge(native) {
  const gate=createGate();let store=null,closed=false,readiness={ready:false,reason:'Native settlement has not been checked'};
  const db=()=>{if(!store||closed)throw Error('NPC market store unavailable');return store.db;};
  function attach(value) {
    if(!value||!value.db)throw Error('NPC market persistent store required');
    if(store && store!==value)throw Error('NPC market bridge already bound');
    store=value;closed=false;
    db().exec(`CREATE TABLE IF NOT EXISTS nm_native_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nm_native_ops(operation_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
        state TEXT NOT NULL, order_json TEXT NOT NULL, quantity INTEGER NOT NULL,
        saga_json TEXT, result_json TEXT, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS nm_funding(operation_key TEXT PRIMARY KEY, day TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nm_native_outbox(operation_key TEXT PRIMARY KEY, payload TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending');
      CREATE TABLE IF NOT EXISTS nm_wallet_intents(operation_key TEXT PRIMARY KEY, owner_id INTEGER NOT NULL,
        is_corp INTEGER NOT NULL, state TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS nm_native_ops_recovery ON nm_native_ops(state,updated_at);
      CREATE INDEX IF NOT EXISTS nm_native_outbox_pending ON nm_native_outbox(state);`);
  }
  async function ready(){
    try {
    const health=await native.marketDaemonClient.call('Health',{});
    if(!health||!Array.isArray(health.capabilities)||!health.capabilities.includes('conditional-fill-v1'))
      throw Error('NPC Market Buyers requires native market capability conditional-fill-v1');
    if(!native.authority.isWalletAuthorityProcessEnabled())
      throw Error('NPC Market Buyers requires the durable wallet authority process');
    readiness={ready:true,reason:null,capability:'conditional-fill-v1',walletAuthority:true};
    return true;
    } catch(error){readiness={ready:false,reason:String(error.message||error)};throw error;}
  }
  function walletMetadata(options,ownerID,isCorp=false) {
    const key=String(options&&options.idempotencyKey||'');
    if(!key.startsWith('npc-market:'))return {};
    if(ownerID) {
      const target={kind:isCorp?'corporation':'character',ownerID};
      const intent=db().prepare('SELECT owner_id,is_corp FROM nm_wallet_intents WHERE operation_key=?').get(key);
      if(intent) {
        if(intent.owner_id!==ownerID||Boolean(intent.is_corp)!==isCorp)throw Error('NPC wallet intent owner mismatch');
        if(native.walletReceipts&&!native.walletReceipts.findOwnerReceipt(target,key)&&native.walletReceipts.isOwnerReceiptListSaturated(target))
          throw Error('NPC wallet receipt may have been evicted; owner reconciliation required');
      } else db().prepare('INSERT INTO nm_wallet_intents VALUES (?,?,?,?)').run(key,ownerID,isCorp?1:0,'pending');
    }
    return {commandID:key,source:'npc-market-buyers'};
  }
  function hasWalletReceipt(options,ownerID,isCorp=false) {
    const key=String(options&&options.idempotencyKey||'');
    return Boolean(key.startsWith('npc-market:')&&native.walletReceipts&&
      native.walletReceipts.findOwnerReceipt({kind:isCorp?'corporation':'character',ownerID},key));
  }
  function walletAcknowledged(options,result) {
    const key=String(options&&options.idempotencyKey||'');
    if(!key.startsWith('npc-market:'))return;
    if(result&&result.fingerprintMismatch)throw Error('NPC wallet command receipt fingerprint mismatch; owner reconciliation required');
    db().prepare("UPDATE nm_wallet_intents SET state='acknowledged' WHERE operation_key=?").run(key);
  }
  function hasUnacknowledgedWallet(operationKey) {
    const prefix=operationKey+':wallet:';
    return Boolean(db().prepare("SELECT 1 FROM nm_wallet_intents WHERE state='pending' AND substr(operation_key,1,?)=? LIMIT 1").get(prefix.length,prefix));
  }
  function identity(stationID) {
    const stored=db().prepare("SELECT value FROM nm_native_meta WHERE key='buyerID'").get();
    let id=stored?Number(stored.value):0;
    if(!id) {
      // Recover an identity if the world write committed before the mod DB did.
      const rows=native.database.read('characters','/');
      const matches=Object.entries(rows.success&&rows.data||{}).filter(([,r])=>r&&r.npcMarketInstitution===MARKER);
      if(matches.length>1)throw Error('Multiple institutional buyer identities; owner reconciliation required');
      id=matches.length?Number(matches[0][0]):native.allocator.reserveCharacterID();
      db().prepare('INSERT INTO nm_native_meta VALUES (?,?)').run('buyerID',String(id));
    }
    const existing=native.characters.peekCharacterRecord(id);
    if(existing) {
      if(existing.npcMarketInstitution!==MARKER||existing.accountId!==null)
        throw Error('Institutional buyer identity collision');
      return id;
    }
    const station=native.getStationRecord(stationID);
    if(!station)throw definitive('Unsupported market station');
    const timestamp=(BigInt(Date.now())*10000n+116444736000000000n).toString();
    // Native itemStore treats accountId:null as an owner without a login and
    // skips its player starter-ship bootstrap. Suppress skill grants as well.
    const record={accountId:null,characterName:'EveJS Institutional Procurement',npcMarketInstitution:MARKER,suppressSkillBootstrap:true,
      description:'Server-managed NPC Market Buyers institution. No login account. Purchased goods retained in station hangars.',
      gender:1,bloodlineID:1,ancestryID:1,raceID:1,typeID:1373,corporationID:1000009,
      schoolID:11,allianceID:0,factionID:500001,stationID,homeStationID:stationID,cloneStationID:stationID,
      solarSystemID:native.getStationSolarSystemID(stationID),
      constellationID:native.getStationConstellationID(stationID),regionID:Number(station.regionID||station.regionId||0),
      createDateTime:timestamp,startDateTime:timestamp,logoffDate:timestamp,
      balance:0,aurBalance:0,plexBalance:0,balanceChange:0,walletJournal:[],marketTransactions:[],
      employmentHistory:[],standingData:{char:[],corp:[],npc:[]},characterAttributes:{charisma:20,intelligence:20,memory:20,perception:20,willpower:20},
      skillPoints:0,freeSkillPoints:0,shipID:0,skillHistory:[],boosters:[],implants:[],jumpClones:[]};
    const write=native.database.write('characters',`/${id}`,record);
    if(!write||!write.success)throw Error('Institutional identity creation failed');
    const flush=native.database.flushTableSync('characters');
    if(!flush||!flush.success)throw Error('Institutional identity persistence failed');
    return id;
  }
  function normalize(ownerOrder,escrow) {
    const row=native.getOwnerOrderResponseOrder(ownerOrder);
    const sellerID=Number(escrow.ownerId),seller=native.characters.peekCharacterRecord(sellerID);
    if(!seller||Number(seller.accountId)<=0||seller.npcMarketInstitution)return null;
    const ownerID=Number(ownerOrder.owner_id),isCorp=Boolean(ownerOrder.is_corp);
    if(row.bid||ownerOrder.state!=='open'||String(ownerOrder.source||row.source)!=='player')return null;
    if(isCorp ? Number(escrow.walletOwnerId)!==ownerID : ownerID!==sellerID)return null;
    const entered=Number(row.vol_entered),remaining=Number(row.vol_remaining);
    const originalQuantity=Number.isSafeInteger(entered)&&entered>=remaining&&entered>0?entered:null;
    return {orderID:String(ownerOrder.order_id||row.order_id),sellerID,ownerID,isCorp,
      accountKey:isCorp?Number(escrow.accountKey):null,typeID:Number(row.type_id),stationID:Number(row.station_id),
      regionID:Number(row.region_id),price:Number(row.price),quantity:remaining,originalQuantity,source:'player',
      issuedAt:row.issued_at,
      expiresAt:Number.isFinite(Date.parse(row.issued_at))&&Number(row.duration_days)>0?
        new Date(Date.parse(row.issued_at)+Number(row.duration_days)*86400000).toISOString():null,
      reason:isCorp&&!native.authority.isWalletAuthorityProcessEnabled()?'corp wallet authority unavailable':null};
  }
  async function listOrders(){
    const orders=[];
    for(const escrow of native.listEscrowRecords()) {
      if(escrow.escrowType==='buy'||escrow.escrowType==='seed-fill'||escrow.pendingFill||escrow.state==='placing')continue;
      let current;
      try{current=await native.fetchOrderById(escrow.orderId);}catch(error){if(String(error.message||'').includes('not found'))continue;throw error;}
      const order=normalize(current,escrow);if(order)orders.push(order);
    }
    return orders;
  }
  async function fund(buyerID,operationKey,grossISK) {
    if(!Number.isSafeInteger(money(grossISK))||money(grossISK)<=0)throw definitive('Purchase amount exceeds supported wallet precision');
    let receipt=db().prepare('SELECT * FROM nm_funding WHERE operation_key=?').get(operationKey);
    if(!receipt) {
      const wallet=native.wallet.getCharacterWallet(buyerID);
      if(!wallet)throw Error('Institutional buyer wallet unavailable');
      const amount=Math.max(0,money(grossISK)-money(wallet.balance));
      const day=new Date().toISOString().slice(0,10),config=store.getConfig();
      const issued=db().prepare('SELECT COALESCE(SUM(amount_cents),0) AS n FROM nm_funding WHERE day=?').get(day).n;
      if(!config.ironMode&&issued+amount>money(config.dailyBudgetISK))throw definitive('Limited mode: daily institutional funding cap exhausted');
      db().prepare('INSERT INTO nm_funding VALUES (?,?,?,?)').run(operationKey,day,amount,'pending');
      receipt={amount_cents:amount,state:'pending'};
    }
    if(receipt.state==='committed')return;
    if(receipt.amount_cents>0) {
      const fundingOptions={description:'NPC Market Buyers: receipted institutional procurement funding',entryTypeID:native.wallet.JOURNAL_ENTRY_TYPE.GM_CASH_TRANSFER,
          ownerID1:buyerID,ownerID2:buyerID,referenceID:buyerID,idempotencyKey:`${operationKey}:funding`};
      const result=await native.wallet.adjustCharacterBalanceAsync(buyerID,receipt.amount_cents/100,
        fundingOptions,walletMetadata(fundingOptions,buyerID,false));
      walletAcknowledged(fundingOptions,result);
      if(!result||!result.success||result.fingerprintMismatch)throw Error('Institutional funding receipt mismatch or failure');
    }
    db().prepare("UPDATE nm_funding SET state='committed' WHERE operation_key=?").run(operationKey);
  }
  function completed(saga,fill) {
    const operationKey=saga.operationKey;
    if(!saga.npcMarketExpected)return;
    const current=db().prepare('SELECT * FROM nm_native_ops WHERE operation_key=?').get(operationKey);
    if(!current)throw Error('Native NPC receipt anchor missing');
    const order=JSON.parse(current.order_json);
    const result={state:'settled',operationKey,quantity:saga.tradedQuantity,grossISK:saga.grossCost,
      orderID:String(saga.orderID),buyerID:saga.buyerCharacterID,sellerID:saga.sellerCharacterID,
      remainingQuantity:Number(fill.vol_remaining),taxISK:saga.salesTax,goodsDisposition:'retained in institutional station hangar'};
    const date=(BigInt(new Date(saga.createdAt).getTime())*10000n+116444736000000000n).toString();
    const entry={transactionDate:date,typeID:saga.typeID,quantity:saga.tradedQuantity,price:saga.orderPrice,
      stationID:saga.destinationStationID,buyerID:saga.buyerWalletID,sellerID:saga.sellerWalletID,journalRefID:-1};
    db().transaction(()=>{
      for(const [side,owner] of [['buyer',{id:saga.buyerCharacterID,isCorp:false}],
        ['seller',{id:saga.sellerWalletID,isCorp:saga.sellerIsCorp,accountKey:saga.sellerAccountKey}]]) {
        db().prepare('INSERT OR IGNORE INTO nm_native_outbox(operation_key,payload) VALUES (?,?)').run(
          `${operationKey}:history:${side}`,JSON.stringify({owner,entry:{...entry,clientID:side==='buyer'?saga.sellerWalletID:saga.buyerWalletID}}));
      }
      db().prepare("UPDATE nm_native_ops SET state='settled',saga_json=?,result_json=?,updated_at=? WHERE operation_key=?")
        .run(JSON.stringify(saga),JSON.stringify(result),Date.now(),operationKey);
    })();
  }
  async function drainOutbox() {
    for(const row of db().prepare("SELECT * FROM nm_native_outbox WHERE state='pending' ORDER BY operation_key").all()) {
      const {owner,entry}=JSON.parse(row.payload),intent={idempotencyKey:row.operation_key},metadata=walletMetadata(intent,owner.id,owner.isCorp);
      const result=owner.isCorp?await native.corpWallet.appendCorporationMarketTransactionAsync(owner.id,owner.accountKey,entry,metadata):
        await native.wallet.appendCharacterMarketTransactionAsync(owner.id,entry,metadata);
      if(!result||!result.success||result.fingerprintMismatch)throw Error('Market history outbox receipt failed');
      walletAcknowledged(intent,result);
      db().prepare("UPDATE nm_native_outbox SET state='sent' WHERE operation_key=?").run(row.operation_key);
    }
  }
  async function buyUnlocked(order,quantity,operationKey) {
    if(!Number.isSafeInteger(quantity)||quantity<=0||!String(operationKey).startsWith('npc-market:'))throw definitive('Invalid NPC purchase');
    await ready();
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify({order,quantity})).digest('hex');
    let op=db().prepare('SELECT * FROM nm_native_ops WHERE operation_key=?').get(operationKey);
    if(op&&op.fingerprint!==fingerprint)throw definitive('NPC operation key reused for different purchase');
    if(op&&op.state==='settled'){
      const anchor=native.getEscrowRecord(order.orderID);
      if(anchor&&anchor.pendingFill&&anchor.pendingFill.operationKey===operationKey)
        await native.executePlayerSellFillSaga(anchor,anchor.pendingFill,String(order.typeID));
      db().prepare('UPDATE nm_native_ops SET saga_json=NULL WHERE operation_key=?').run(operationKey);
      await drainOutbox();return JSON.parse(op.result_json);
    }
    if(op&&op.state==='rejected')throw definitive('NPC purchase previously rejected');
    let escrow=native.getEscrowRecord(order.orderID),saga;
    saga=escrow&&escrow.pendingFill;
    if(saga&&saga.operationKey!==operationKey)throw Error('Another pending market operation owns escrow');
    if(!saga) {
      if(op&&op.saga_json) {
        const previous=JSON.parse(op.saga_json);
        if(escrow&&!escrow.pendingFill&&Number(escrow.fillAttemptSequence)>=previous.attempt&&
            Number(escrow.remainingQuantity)===order.quantity) {
          db().prepare("UPDATE nm_native_ops SET state='rejected',updated_at=? WHERE operation_key=?").run(Date.now(),operationKey);
          throw definitive('NPC purchase previously compensated');
        }
        throw Error('Pending native settlement lost its escrow anchor; owner reconciliation required');
      }
      if(!escrow||escrow.pendingFill)throw definitive('Order no longer available');
      const current=await native.fetchOrderById(order.orderID),checked=normalize(current,escrow);
      if(!checked||checked.reason||checked.price!==order.price||checked.quantity!==order.quantity||
          checked.ownerID!==order.ownerID||checked.sellerID!==order.sellerID||checked.typeID!==order.typeID||
          checked.stationID!==order.stationID||checked.isCorp!==order.isCorp||quantity>checked.quantity)
        throw definitive(checked&&checked.reason||'Order changed, closed or no longer eligible');
      if(!op)db().prepare('INSERT INTO nm_native_ops VALUES (?,?,?,?,?,?,?,?)').run(operationKey,fingerprint,'pending',JSON.stringify(order),quantity,null,null,Date.now());
      const buyerID=identity(order.stationID),grossISK=money(order.price*quantity)/100;
      await fund(buyerID,operationKey,grossISK);
      const context=native.buildCharacterMarketContext(null,order.sellerID,order.stationID);
      saga=native.buildPlayerSellFillSaga({sellOrder:current,escrowRecord:escrow,sellerCharacterID:order.sellerID,
        sellerWalletID:order.ownerID,sellerIsCorp:order.isCorp,sellerAccountKey:order.accountKey,
        buyerCharacterID:buyerID,destinationStationID:order.stationID,typeID:order.typeID,tradedQuantity:quantity,
        availableQuantity:order.quantity,orderPrice:order.price,grossCost:grossISK,
        salesTax:native.computeSalesTaxAmount(context,grossISK),stationMarketOwnerID:native.getMarketCounterpartyOwnerID(order.stationID)});
      saga.operationKey=operationKey;
      // Custody keys were derived before the externally stable operation key.
      saga.itemLegs.forEach((leg,index)=>{leg.forwardKey=`${operationKey}:inventory:${index}`;leg.compensationKey=`${operationKey}:inventory-compensate:${index}`;});
      saga.npcMarketExpected={owner_id:order.ownerID,is_corp:order.isCorp,type_id:order.typeID,
        station_id:order.stationID,price:order.price,vol_remaining:order.quantity,source:'player'};
      native.persistPlayerSellFillSaga(escrow,saga);
      db().prepare('UPDATE nm_native_ops SET saga_json=?,updated_at=? WHERE operation_key=?').run(JSON.stringify(saga),Date.now(),operationKey);
    }
    try {
      const result=await native.executePlayerSellFillSaga(escrow,saga,String(order.typeID));
      if(result.compensated){db().prepare("UPDATE nm_native_ops SET state='rejected',updated_at=? WHERE operation_key=?").run(Date.now(),operationKey);throw definitive('NPC purchase compensated');}
    }catch(error){
      const remaining=native.getEscrowRecord(order.orderID);
      if(!remaining||!remaining.pendingFill) {
        const committed=db().prepare('SELECT state FROM nm_native_ops WHERE operation_key=?').get(operationKey);
        if(!committed||committed.state!=='settled'){
          db().prepare("UPDATE nm_native_ops SET state='rejected',updated_at=? WHERE operation_key=?").run(Date.now(),operationKey);
          error.definitive=true;
        }
      }
      throw error;
    }
    db().prepare('UPDATE nm_native_ops SET saga_json=NULL WHERE operation_key=?').run(operationKey);
    await drainOutbox();
    const receipt=db().prepare('SELECT result_json FROM nm_native_ops WHERE operation_key=?').get(operationKey);
    if(!receipt||!receipt.result_json)throw Error('Committed NPC receipt missing');
    native.notifyOwnOrdersChanged(order.sellerID,[{...JSON.parse(JSON.stringify(order)),order_id:order.orderID,
      owner_id:order.ownerID,is_corp:order.isCorp,row:{type_id:order.typeID,price:order.price,station_id:order.stationID,
        vol_remaining:JSON.parse(receipt.result_json).remainingQuantity}}],
      JSON.parse(receipt.result_json).remainingQuantity?'PartialFill':'Filled',order.isCorp);
    return JSON.parse(receipt.result_json);
  }
  async function attempt(order,quantity,operationKey) {
    try{return await buyUnlocked(order,quantity,operationKey);}catch(error){
      if(error.definitive){
        const row=db().prepare('SELECT fingerprint,state FROM nm_native_ops WHERE operation_key=?').get(operationKey),anchor=native.getEscrowRecord(order.orderID);
        const fingerprint=crypto.createHash('sha256').update(JSON.stringify({order,quantity})).digest('hex');
        if(row&&row.state!=='settled'&&row.fingerprint===fingerprint&&(!anchor||!anchor.pendingFill))
          db().prepare("UPDATE nm_native_ops SET state='rejected',saga_json=NULL,updated_at=? WHERE operation_key=?").run(Date.now(),operationKey);
      }
      throw error;
    }
  }
  const buy=gate.wrap(attempt);
  const recover=gate.wrap(async()=>{
    await ready();await drainOutbox();
    for(const row of db().prepare("SELECT * FROM nm_native_ops WHERE state IN ('pending','settled') AND saga_json IS NOT NULL ORDER BY updated_at").all()) {
      const order=JSON.parse(row.order_json),anchor=native.getEscrowRecord(order.orderID);
      if(row.state==='settled'&&(!anchor||!anchor.pendingFill||anchor.pendingFill.operationKey!==row.operation_key)){
        db().prepare('UPDATE nm_native_ops SET saga_json=NULL WHERE operation_key=?').run(row.operation_key);continue;
      }
      try{await attempt(order,row.quantity,row.operation_key);}catch(error){if(!error.definitive)throw error;}
    }
    // Funding-only pending operations also need a deterministic retry.
    for(const row of db().prepare("SELECT * FROM nm_native_ops WHERE state='pending' AND saga_json IS NULL ORDER BY updated_at").all())
      try{await attempt(JSON.parse(row.order_json),row.quantity,row.operation_key);}catch(error){if(!error.definitive)throw error;}
  });
  return {attach,ready,status:()=>({...readiness}),walletMetadata,hasWalletReceipt,walletAcknowledged,hasUnacknowledgedWallet,
    completed,wrap:gate.wrap,listOrders,buy,recover,
    close(){closed=true;},_testing:{identity,normalize,fund,drainOutbox}};
}
module.exports={createNativeBridge,createGate};
