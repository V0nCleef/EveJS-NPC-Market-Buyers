'use strict';
const crypto=require('node:crypto');
const PROTOCOL='npc-market-buyers-orphan-zero-fill-v1';
const MARKER='npc-market-buyers:institution:v1';
const cents=value=>Math.round(Number(value)*100);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const hash=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(canonical(value))).digest('hex');
function blocked(message){const error=Error('NPC orphan recovery blocked: '+message);error.code='NPC_ORPHAN_UNPROVEN';throw error;}
function check(value,message){if(!value)blocked(message);}
function integer(value){return Number.isSafeInteger(value)&&value>0;}
function parse(value,label){try{return typeof value==='string'?JSON.parse(value):value;}catch(_){blocked('invalid '+label);}}
function journalProof(result,expected){
  check(Number.isSafeInteger(expected.amountCents),'wallet amount exceeds safe precision');
  check(result&&cents(result.delta)===expected.amountCents,'wallet committed delta differs');
  const entry=result.journalEntry;
  check(entry&&cents(entry.amount)===expected.amountCents&&Number(entry.referenceID)===expected.referenceID&&
    Number(entry.entryTypeID)===expected.entryTypeID&&Number(entry.ownerID1)===expected.ownerID1&&
    Number(entry.ownerID2)===expected.ownerID2&&Number(entry.accountKey)===1000&&Number(entry.currency)===1,'wallet journal identity differs');
  check(!result.capped&&!result.fingerprintMismatch,'wallet result was clipped or mismatched');
  if(result.data?.characterID!==undefined)check(Number(result.data.characterID)===expected.ownerID,'wallet result belongs to another owner');
  if(result.previousBalance!==undefined&&result.data?.balance!==undefined)
    check(cents(result.previousBalance)+expected.amountCents===cents(result.data.balance),'wallet balance delta differs');
  return {deltaCents:expected.amountCents,transactionID:entry.transactionID,transactionDate:entry.transactionDate,
    referenceID:entry.referenceID,entryTypeID:entry.entryTypeID,ownerID1:entry.ownerID1,ownerID2:entry.ownerID2,
    accountKey:entry.accountKey,currency:entry.currency,description:entry.description};
}
function walletProof(owner,expected,{authorityFingerprint=null,requireLegacy=false}={}){
  check(owner&&Array.isArray(owner.walletOperationReceipts)&&Array.isArray(owner.walletAuthorityReceipts),'wallet owner receipt ledgers unavailable');
  check(owner.walletOperationReceipts.filter(row=>row?.idempotencyKey===expected.key).length<=1&&
    owner.walletAuthorityReceipts.filter(row=>row?.commandID===expected.key).length<=1,'duplicate wallet receipts contradict the owner ledger');
  const index=owner.walletOperationReceipts.findIndex(row=>row?.idempotencyKey===expected.key);
  const legacy=index<0?null:owner.walletOperationReceipts[index];
  const authority=owner.walletAuthorityReceipts.find(row=>row?.commandID===expected.key);
  if(!legacy&&!authority)return null;
  const proof={key:expected.key,ownerID:expected.ownerID};
  if(legacy){
    const fingerprint=parse(legacy.fingerprint,'wallet operation fingerprint');
    for(const [field,value]of Object.entries({charId:expected.ownerID,amount:expected.amountCents/100,
      referenceID:expected.referenceID,entryTypeID:expected.entryTypeID,ownerID1:expected.ownerID1,ownerID2:expected.ownerID2,accountKey:1000,currency:1}))
      check(field==='amount'?cents(fingerprint[field])===expected.amountCents:Number(fingerprint[field])===value,'wallet fingerprint differs: '+field);
    if(expected.description!==undefined)check(fingerprint.description===expected.description,'wallet compensation description differs');
    check(typeof fingerprint.description==='string'&&fingerprint.description===legacy.result?.journalEntry?.description,'wallet fingerprint/journal description differs');
    proof.legacy={index,fingerprint:legacy.fingerprint,...journalProof(legacy.result,expected)};
  }
  if(requireLegacy)check(legacy,'retained positive legacy receipt/window is required');
  if(authority){
    check(authority.commandType==='character.adjust-isk'&&authority.result?.success===true,'wallet authority did not commit the expected command');
    if(authorityFingerprint!==null)check(authority.fingerprint===authorityFingerprint,'wallet authority command fingerprint differs');
    proof.authority={commandID:authority.commandID,fingerprint:authority.fingerprint,committedAt:authority.committedAt,
      ...journalProof(authority.result,expected)};
    if(proof.legacy)check(proof.legacy.transactionID===proof.authority.transactionID,'owner ledgers describe different wallet executions');
  }
  return proof;
}
function expectedWallet(key,ownerID,amountCents,entryTypeID,ownerID1,ownerID2,referenceID){
  return {key,ownerID,amountCents,entryTypeID,ownerID1,ownerID2,referenceID};
}
function assertMarket(e,order,quantity){
  const fill=e.fillReceipt,response=parse(fill?.response_json,'daemon fill response'),current=e.currentOrder,row=current?.row||current;
  check(fill&&String(fill.order_id)===String(order.orderID)&&fill.idempotency_key===e.key+':daemon-fill'&&Number(fill.fill_quantity)===quantity,'daemon receipt request identity differs');
  for(const value of [response,{...row,...current}]){
    check(value&&String(value.order_id)===String(order.orderID)&&Number(value.owner_id)===order.ownerID&&
      !value.is_corp&&Number(value.type_id)===order.typeID&&Number(value.station_id)===order.stationID&&
      cents(value.price)===cents(order.price)&&Number(value.vol_remaining)===order.quantity,'terminal daemon order identity differs');
    check(['expired','cancelled'].includes(value.state),'daemon order is not terminal');
  }
  check(response.filled_quantity===0,'daemon receipt is not a proven ZERO fill');
  check(row.bid===false||row.bid===0,'terminal order is not a sell order');
  check((current.source||row.source)==='player','terminal order is not player-owned source');
  return {idempotency_key:fill.idempotency_key,order_id:fill.order_id,requestedQuantity:fill.fill_quantity,response,created_at:fill.created_at,
    current:{orderID:String(order.orderID),ownerID:Number(current.owner_id),isCorp:Boolean(current.is_corp),source:current.source||row.source,
      state:current.state,typeID:Number(row.type_id),stationID:Number(row.station_id),priceCents:cents(row.price),remaining:Number(row.vol_remaining),bid:Boolean(row.bid)}};
}
function custodyProof(receipt,key,{sourceOwner,sourceLocation,destinationOwner,destinationLocation,typeID,quantity,itemID,reason,actor}){
  const f=receipt?.fingerprint;
  const expectedOperation=sourceOwner===destinationOwner?'move-item-to-location':'transfer-item-to-owner-location';
  check(receipt?.schemaVersion===3&&receipt.state==='completed'&&receipt.operation===expectedOperation&&
    receipt.metadata?.itemCustody?.idempotencyKey===key&&
    receipt.receiptKey==='item-custody:local:'+crypto.createHash('sha256').update(key).digest('hex')&&
    receipt.metadata.itemCustody.commandType==='item-custody.transfer'&&receipt.metadata.itemCustody.reason===reason,'durable custody receipt unavailable');
  check(f?.commandType==='item-custody.transfer'&&f.route==='local-move'&&f.reason===reason&&
    f.actor===actor&&f.source?.kind==='owner-location'&&f.destination?.kind==='owner-location'&&f.destinationItemPatch===null&&
    f.source?.ownerID===sourceOwner&&f.source.locationID===sourceLocation&&f.source.flagID===4&&
    f.destination?.ownerID===destinationOwner&&f.destination.locationID===destinationLocation&&f.destination.flagID===4&&
    f.itemSpec?.itemID===itemID&&Number(receipt.resultData?.quantity)===quantity,'custody receipt identity differs');
  if(reason==='market-escrow-return')check(f.itemSpec.quantity==null||f.itemSpec.quantity===quantity,'terminal custody requested quantity differs');
  else check(f.itemSpec.quantity===quantity,'custody requested quantity differs');
  const delivered=receipt.resultData.changes?.filter(change=>!change.removed&&change.item?.ownerID===destinationOwner&&
    change.item.locationID===destinationLocation&&change.item.flagID===4&&change.item.typeID===typeID&&
    Number(change.item.stacksize??change.item.quantity)===quantity).map(change=>change.item);
  check(delivered?.length===1&&integer(delivered[0].itemID),'custody result does not prove one exact delivered item');
  return {receiptKey:receipt.receiptKey,completedAtMs:receipt.completedAtMs,idempotencyKey:key,fingerprint:f,
    quantity,destinationItem:delivered[0]};
}
function buildPlan(e){
  check(e.hostQualified===true,'native wallet FIFO/financial source ABI is not qualified');
  const op=e.operation,native=e.nativeOperation,order=parse(op?.order_json,'engine order'),saga=parse(native?.saga_json,'native saga');
  check(op?.state==='pending'&&native?.state==='pending'&&op.operation_key===e.key&&native.operation_key===e.key&&e.key.startsWith('npc-market:'),'operation is not matching pending NPC work');
  check(same(order,parse(native.order_json,'native order'))&&op.quantity===native.quantity&&integer(op.quantity)&&
    op.seller_id===order.sellerID&&op.type_id===order.typeID&&op.cost_cents===cents(order.price*op.quantity),'engine/native order, quantity or cost differ');
  check(native.fingerprint===hash(JSON.stringify({order,quantity:op.quantity})),'native operation fingerprint differs');
  check(!e.anchor&&!e.sale&&e.outbox.length===0,'native anchor, sale or history already exists');
  check(order.isCorp===false&&order.ownerID===order.sellerID&&saga?.direction==='buyer-consumes-player-sell'&&saga.schemaVersion===1&&
    !saga.sellerIsCorp&&!saga.buyerIsCorp&&!saga.crossingOrderID&&!Number(saga.priceImprovementRefund)&&saga.chargeBuyerWallet!==false,'unsupported corporation/crossing or saga protocol');
  const buyer=saga.buyerCharacterID,seller=order.sellerID,q=op.quantity,gross=op.cost_cents,tax=cents(saga.salesTax);
  check(Number.isSafeInteger(gross)&&gross>0&&Number.isSafeInteger(cents(order.price))&&cents(order.price)>0&&
    integer(order.quantity)&&integer(order.typeID)&&integer(order.stationID)&&integer(order.ownerID),'purchase amounts or IDs exceed safe precision');
  check(integer(buyer)&&integer(seller)&&buyer!==seller&&saga.buyerWalletID===buyer&&saga.sellerWalletID===seller&&saga.sellerCharacterID===seller&&
    saga.operationKey===e.key&&String(saga.orderID)===String(order.orderID)&&saga.typeID===order.typeID&&saga.destinationStationID===order.stationID&&
    saga.tradedQuantity===q&&saga.availableQuantity===order.quantity&&cents(saga.grossCost)===gross&&Number.isSafeInteger(tax)&&tax>=0&&tax<=gross,'saga economic identity differs');
  check(e.buyerIdentity?.accountId===null&&e.buyerIdentity.npcMarketInstitution===MARKER&&e.buyerID===buyer,'institutional buyer identity differs');
  check(saga.itemLegs?.length===1,'only one proven personal custody leg is supported');
  const leg=saga.itemLegs[0],source=leg.sourceItem,escrowLocation=e.escrowLocation;
  check(leg.quantity===q&&leg.forwardKey===e.key+':inventory:0'&&leg.compensationKey===e.key+':inventory-compensate:0'&&
    source?.ownerID===seller&&source.locationID===escrowLocation&&source.flagID===4&&source.typeID===order.typeID&&
    Number(source.stacksize??source.quantity)===order.quantity,'original custody leg differs');
  const marketProof=assertMarket(e,order,q);
  const wallets=[expectedWallet(e.key+':wallet:buyer-debit',buyer,-gross,2,buyer,seller,order.stationID),
    expectedWallet(e.key+':wallet:seller-credit',seller,gross,2,buyer,seller,order.stationID)];
  if(tax)wallets.push(expectedWallet(e.key+':wallet:tax-debit',seller,-tax,54,saga.stationMarketOwnerID,seller,order.stationID));
  check(e.funding?.state==='committed'&&Number.isSafeInteger(e.funding.amount_cents)&&e.funding.amount_cents>=0&&e.funding.amount_cents<=gross,'funding proof differs');
  if(e.funding.amount_cents)wallets.push(expectedWallet(e.key+':funding',buyer,e.funding.amount_cents,3,buyer,buyer,buyer));
  const walletProofs=wallets.map(expected=>{
    const proof=walletProof(e.wallets[expected.ownerID],expected,{requireLegacy:true});check(proof,'original wallet leg is unproven');return proof;
  });
  const fillAt=Date.parse(marketProof.created_at);
  check(Number.isFinite(fillAt),'daemon receipt creation time is invalid');
  for(const proof of walletProofs){
    const value=proof.legacy.transactionDate;
    let at;try{at=Number((BigInt(value)-116444736000000000n)/10000n);}catch(_){blocked('original wallet receipt time is unavailable');}
    check(at>=Number(op.created_at)-60000&&at<=fillAt+1,'original wallet leg was refreshed after the terminal fill or predates this operation');
  }
  // With the bound native ABI, duplicates return before append and generic
  // receipts prepend/slice. A retained forward therefore retains EVERY later
  // compensation in that same FIFO; saturation alone is never an absence proof.
  const previousCompensations=[
    [buyer,['buyer-compensate']],
    [seller,['seller-compensate',...(tax?['tax-compensate']:[])]],
  ];
  for(const [ownerID,suffixes]of previousCompensations){
    const owner=e.wallets[ownerID];
    for(const suffix of suffixes){const key=e.key+':wallet:'+suffix;
      check(!owner.walletOperationReceipts.some(r=>r?.idempotencyKey===key)&&!owner.walletAuthorityReceipts.some(r=>r?.commandID===key),'an older native compensation requires owner reconciliation');
    }
  }
  check(!e.oldInventoryCompensation,'an older inventory compensation already exists');
  const forward=custodyProof(e.forwardReceipt,leg.forwardKey,{sourceOwner:seller,sourceLocation:escrowLocation,destinationOwner:buyer,
    destinationLocation:order.stationID,typeID:order.typeID,quantity:q,itemID:source.itemID,reason:'market-escrow-deliver',actor:buyer});
  const current=e.items[forward.destinationItem.itemID];
  check(current&&current.ownerID===buyer&&current.locationID===order.stationID&&current.flagID===4&&current.typeID===order.typeID&&
    Number(current.stacksize??current.quantity)===q,'delivered institutional item has changed');
  const remainder=order.quantity-q;
  check(remainder>0,'terminal remainder proof is required for the original hangar destination');
  const terminal=custodyProof(e.terminalReceipt,e.terminalReturnKey,{sourceOwner:seller,sourceLocation:escrowLocation,
    destinationOwner:seller,destinationLocation:order.stationID,typeID:order.typeID,quantity:remainder,itemID:source.itemID,reason:'market-escrow-return',actor:seller});
  check([e.walletMaxBalance,e.wallets[seller].balance,e.wallets[buyer].balance].every(value=>Number.isSafeInteger(cents(value)))&&
    Number.isSafeInteger(cents(e.wallets[seller].balance)+tax)&&Number.isSafeInteger(cents(e.wallets[buyer].balance)+gross)&&cents(e.wallets[seller].balance)+tax>=gross&&
    cents(e.wallets[seller].balance)+tax<=cents(e.walletMaxBalance)&&cents(e.wallets[buyer].balance)+gross<=cents(e.walletMaxBalance),'wallet funds/capacity cannot admit exact compensation');
  const stem=e.key+':orphan-zero-fill-v1';
  const walletLegs=[];
  const add=(name,ownerID,amountCents,entryTypeID,ownerID1,ownerID2)=>{
    const key=stem+':wallet:'+name,description='NPC Market Buyers orphan compensation: '+name+' / '+order.orderID;
    const options={description,entryTypeID,ownerID1,ownerID2,referenceID:order.stationID,accountKey:1000,currency:1,
      idempotencyKey:key,requireExactCredit:true};
    walletLegs.push({...expectedWallet(key,ownerID,amountCents,entryTypeID,ownerID1,ownerID2,order.stationID),name,description,options});
  };
  if(tax)add('tax-refund',seller,tax,54,saga.stationMarketOwnerID,seller);
  add('seller-reversal',seller,-gross,2,buyer,seller);add('buyer-refund',buyer,gross,2,buyer,seller);
  const custodyKey=stem+':inventory:0';
  const custody={name:'goods-return',key:custodyKey,itemID:current.itemID,quantity:q,source:{kind:'owner-location',ownerID:buyer,locationID:order.stationID,flagID:4},
    destination:{kind:'owner-location',ownerID:seller,locationID:order.stationID,flagID:4},reason:'market-fill-compensate',actor:seller};
  custody.fingerprint={commandType:'item-custody.transfer',route:'local-move',reason:custody.reason,actor:seller,source:custody.source,destination:custody.destination,
    itemSpec:{itemID:current.itemID,quantity:q},destinationItemPatch:null};
  return {schema:1,protocol:PROTOCOL,operationKey:e.key,nativeFingerprint:native.fingerprint,order,quantity:q,grossCents:gross,taxCents:tax,
    buyerID:buyer,sellerID:seller,marketProof,walletProofs,forward,terminal,custody,walletLegs,
    funding:e.funding,originalWalletKeys:wallets.map(w=>({key:w.key,ownerID:w.ownerID}))};
}
module.exports={PROTOCOL,cents,canonical,same,hash,blocked,check,parse,walletProof,custodyProof,assertMarket,buildPlan};
