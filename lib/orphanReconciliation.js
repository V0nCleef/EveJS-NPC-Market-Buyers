'use strict';
const {PROTOCOL,buildPlan,walletProof,custodyProof,assertMarket,cents,check,same,hash,parse}=require('./orphanEvidence');
function createOrphanReconciliation({native,db,store,walletMetadata,walletAcknowledged,afterEffect=async()=>{}}){
  function existing(key){
    if(!db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='nm_orphan_recovery'").get())return null;
    return db().prepare('SELECT * FROM nm_orphan_recovery WHERE operation_key=?').get(key)||null;
  }
  function ensure(){db().exec(`CREATE TABLE IF NOT EXISTS nm_orphan_recovery(
    operation_key TEXT PRIMARY KEY,schema INTEGER NOT NULL,plan_json TEXT NOT NULL,plan_sha TEXT NOT NULL,
    progress_json TEXT NOT NULL,state TEXT NOT NULL,updated_at INTEGER NOT NULL)`);}
  function save(row){const result=db().prepare('UPDATE nm_orphan_recovery SET progress_json=?,state=?,updated_at=? WHERE operation_key=? AND plan_sha=?')
    .run(JSON.stringify(row.progress),row.state,Date.now(),row.operation_key,row.plan_sha);
    check(result.changes===1,'reconciliation journal compare-and-swap failed');}
  function validateProgress(row,plan){
    const p=row.progress,states=['new','issuing','confirmed'];
    check(p&&p.custody&&states.includes(p.custody.state)&&Array.isArray(p.wallets)&&p.wallets.length===plan.walletLegs.length&&
      p.wallets.every(leg=>leg&&states.includes(leg.state)),'invalid reconciliation progress shape');
    if(p.custody.state==='confirmed')check(p.custody.proof?.idempotencyKey===plan.custody.key,'confirmed custody progress proof differs');
    for(const [i,leg]of p.wallets.entries())if(leg.state==='confirmed')check(leg.proof?.key===plan.walletLegs[i].key&&leg.proof.ownerID===plan.walletLegs[i].ownerID,'confirmed wallet progress proof differs');
    if(p.custody.state!=='confirmed')check(p.wallets.every(leg=>leg.state==='new'),'wallet progress precedes compensated goods');
    let incomplete=false;for(const leg of p.wallets){if(incomplete)check(leg.state==='new','wallet progress is out of order');if(leg.state!=='confirmed')incomplete=true;}
    if(row.state==='compensated')check(p.custody.state==='confirmed'&&p.wallets.every(leg=>leg.state==='confirmed'),'completed reconciliation has unfinished phases');
  }
  function custodyCommitted(api,plan){
    const receipt=api.readCustody(plan.custody.key);if(!receipt)return null;
    check(same(receipt.fingerprint,plan.custody.fingerprint),'compensation custody fingerprint differs');
    return custodyProof(receipt,plan.custody.key,{sourceOwner:plan.buyerID,sourceLocation:plan.order.stationID,
      destinationOwner:plan.sellerID,destinationLocation:plan.order.stationID,typeID:plan.order.typeID,
      quantity:plan.quantity,itemID:plan.custody.itemID,reason:'market-fill-compensate',actor:plan.sellerID});
  }
  async function run(operation,nativeOperation,order,quantity,key){
    const api=native.orphan;
    check(api?.qualified&&typeof api.issueCustody==='function'&&typeof api.issueWallet==='function','native orphan owner API/ABI is unavailable');
    db().pragma('synchronous=FULL');
    check(db().pragma('synchronous',{simple:true})>=2,'reconciliation intent is not durably configured');
    let saved=existing(key),plan,row;
    if(saved){
      plan=parse(saved.plan_json,'reconciliation plan');
      check(saved.schema===1&&saved.plan_sha===hash(plan)&&plan.schema===1&&plan.protocol===PROTOCOL&&plan.operationKey===key&&
        plan.nativeFingerprint===nativeOperation.fingerprint&&same(plan.order,order)&&plan.quantity===quantity,'saved compensation plan identity differs');
      row={...saved,progress:parse(saved.progress_json,'reconciliation progress')};
      check(['pending','compensated'].includes(row.state),'unknown reconciliation state');
    }else{
      const funding=db().prepare('SELECT * FROM nm_funding WHERE operation_key=?').get(key);
      const buyerID=Number(db().prepare("SELECT value FROM nm_native_meta WHERE key='buyerID'").get()?.value);
      const sale=db().prepare('SELECT operation_key FROM nm_sales WHERE operation_key=?').get(key);
      const outbox=db().prepare('SELECT operation_key FROM nm_native_outbox WHERE substr(operation_key,1,?)=?').all(key.length,key);
      plan=buildPlan(await api.evidence({key,operation,nativeOperation,funding,buyerID,sale,outbox,anchor:native.getEscrowRecord(order.orderID)}));
      for(const leg of plan.walletLegs)leg.authorityFingerprint=api.expectedAuthority(leg);
      check(!api.readCustody(plan.custody.key),'unattached older reconciliation custody receipt exists');
      for(const leg of plan.walletLegs){const owner=api.readWallet(leg.ownerID);
        check(!owner.walletOperationReceipts.some(r=>r?.idempotencyKey===leg.key)&&!owner.walletAuthorityReceipts.some(r=>r?.commandID===leg.key),'unattached older reconciliation wallet receipt exists');}
      ensure();row={operation_key:key,schema:1,plan_sha:hash(plan),state:'pending',progress:{custody:{state:'new'},wallets:plan.walletLegs.map(()=>({state:'new'}))}};
      db().prepare('INSERT INTO nm_orphan_recovery(operation_key,schema,plan_json,plan_sha,progress_json,state,updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(key,1,JSON.stringify(plan),row.plan_sha,JSON.stringify(row.progress),'pending',Date.now());
    }
    validateProgress(row,plan);
    const originalSaga=parse(nativeOperation.saga_json,'native saga');
    check(plan.grossCents===operation.cost_cents&&plan.taxCents===cents(originalSaga.salesTax)&&plan.sellerID===order.sellerID&&
      plan.buyerID===originalSaga.buyerCharacterID&&plan.custody.itemID===plan.forward.destinationItem.itemID&&
      plan.walletLegs.every(leg=>leg.authorityFingerprint===api.expectedAuthority(leg)),'saved plan no longer matches its original economic identity');
    check(!native.getEscrowRecord(order.orderID),'native escrow reappeared during orphan compensation');
    // Recheck the immutable native zero-fill/order authority on each retry.
    const market=await api.readMarket(key,order);
    check(same(assertMarket({...market,key},order,quantity),plan.marketProof),'terminal daemon proof changed during compensation');
    let custody=custodyCommitted(api,plan);
    if(!custody){
      check(row.progress.custody.state!=='confirmed','confirmed custody receipt disappeared');
      const item=api.readItem(plan.custody.itemID);
      check(item&&item.ownerID===plan.buyerID&&item.locationID===plan.order.stationID&&item.flagID===4&&item.typeID===plan.order.typeID&&
        Number(item.stacksize??item.quantity)===plan.quantity,'institutional goods changed before compensated delivery');
      row.progress.custody.state='issuing';save(row);
      const result=await api.issueCustody(plan.custody);
      check(result?.success===true&&!result.ambiguous,'native compensated custody was refused or ambiguous');
      await afterEffect('goods-return');custody=custodyCommitted(api,plan);check(custody,'native custody did not persist its compensation receipt');
    }
    row.progress.custody={state:'confirmed',proof:custody};save(row);
    for(const [index,leg]of plan.walletLegs.entries()){
      let owner=api.readWallet(leg.ownerID),proof=walletProof(owner,leg,{authorityFingerprint:leg.authorityFingerprint});
      const progress=row.progress.wallets[index];check(progress&&['new','issuing','confirmed'].includes(progress.state),'invalid wallet phase');
      if(!proof){
        check(progress.state!=='confirmed','confirmed compensation receipt disappeared');
        if(progress.state==='issuing')check(owner.walletAuthorityReceipts.length<api.authorityReceiptLimit&&owner.walletOperationReceipts.length<api.legacyReceiptLimit,
          'issued compensation receipt may have been evicted; owner reconciliation required');
        progress.state='issuing';save(row);
        const metadata=walletMetadata({idempotencyKey:leg.key},leg.ownerID,false);
        const result=await api.issueWallet(leg,metadata);
        check(result?.success===true&&!result.fingerprintMismatch&&cents(result.delta)===leg.amountCents,'native compensation was refused, clipped or mismatched');
        await afterEffect(leg.name);owner=api.readWallet(leg.ownerID);
        proof=walletProof(owner,leg,{authorityFingerprint:leg.authorityFingerprint});check(proof,'native wallet did not persist its compensation receipt');
      }
      walletAcknowledged({idempotencyKey:leg.key},{success:true});row.progress.wallets[index]={state:'confirmed',proof};save(row);
    }
    // All effects now have exact durable native receipts. Preserve the original
    // receipted institutional funding as float; never create a successful fill.
    for(const original of plan.originalWalletKeys)walletAcknowledged({idempotencyKey:original.key},{success:true});
    row.state='compensated';save(row);
    store().recordActivity({kind:'recovery_compensated',characterID:plan.sellerID,operationKey:key+':orphan-zero-fill-v1:compensated',
      message:'Compensated an orphaned NPC purchase after a proven terminal zero fill. Original receipts retained.',
      details:{operationKey:key,orderID:String(order.orderID),quantity:plan.quantity,grossISK:plan.grossCents/100,taxISK:plan.taxCents/100,protocol:PROTOCOL}});
    return {compensated:true,protocol:PROTOCOL,operationKey:key};
  }
  return {run};
}
module.exports={createOrphanReconciliation};
