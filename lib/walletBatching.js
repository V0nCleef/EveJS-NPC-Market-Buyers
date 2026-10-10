"use strict";
// Presentation only. Native wallet commands, receipts, balances and tax entries
// remain untouched. Exact receipt journal IDs link the durable summary to them.
const {AsyncLocalStorage}=require('node:async_hooks');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const vm=require('node:vm');
const summaries={
  EN:'NPC offline sales: {sales} purchases. Gross {gross} ISK; tax {tax} ISK. Item details: NPC Market Buyers → Activity.',
  DE:'NPC-Verkäufe während der Offlinezeit: {sales} Käufe. Brutto {gross} ISK; Steuer {tax} ISK. Artikeldetails: NPC Market Buyers → Aktivität.',
  ES:'Ventas a NPC sin conexión: {sales} compras. Bruto {gross} ISK; impuestos {tax} ISK. Detalles: NPC Market Buyers → Actividad.',
  FR:'Ventes aux PNJ hors ligne : {sales} achats. Brut {gross} ISK ; taxe {tax} ISK. Détails : NPC Market Buyers → Activité.',
  JA:'オフライン中のNPCへの売却：{sales}件。総額 {gross} ISK、税金 {tax} ISK。品目の詳細：NPC Market Buyers → アクティビティ。',
  KO:'오프라인 NPC 판매: {sales}건. 총액 {gross} ISK, 세금 {tax} ISK. 품목별 내역: NPC Market Buyers → 활동.',
  RU:'Продажи NPC за время отсутствия: {sales} покупок. Доход до налога: {gross} ISK; налог: {tax} ISK. Подробности: NPC Market Buyers → Активность.',
  ZH:'离线NPC销售：{sales}笔。税前收入 {gross} ISK；税费 {tax} ISK。物品明细：NPC Market Buyers → 活动。',
};
const locales={EN:'en-US',DE:'de-DE',ES:'es-ES',FR:'fr-FR',JA:'ja-JP',KO:'ko-KR',RU:'ru-RU',ZH:'zh-CN'};
// Item names come from the active client's translated type catalogue.
const saleDescriptions={
  EN:{sale:'NPC sale: {quantity} × {item} at {price} ISK each. Gross {gross} ISK; tax {tax} ISK; net {net} ISK.',
    cancelled:'NPC sale payment (reversed): {quantity} × {item}. Original payment {gross} ISK.',
    pending:'NPC sale payment: {quantity} × {item} at {price} ISK each. Gross {gross} ISK. Settlement pending.',
    tax:'NPC sales tax: {quantity} × {item}. Tax {amount} ISK.',
    reversal:'NPC sale payment reversed: {quantity} × {item}. Returned {amount} ISK.',
    refund:'NPC sales tax refunded: {quantity} × {item}. Refund {amount} ISK.'},
  DE:{sale:'Verkauf an NPC: {quantity} × {item} für je {price} ISK. Brutto {gross} ISK; Steuer {tax} ISK; netto {net} ISK.',
    cancelled:'Zahlung für NPC-Verkauf (rückgängig gemacht): {quantity} × {item}. Ursprüngliche Zahlung: {gross} ISK.',
    pending:'Zahlung für NPC-Verkauf: {quantity} × {item} für je {price} ISK. Brutto {gross} ISK. Abwicklung ausstehend.',
    tax:'Steuer auf NPC-Verkauf: {quantity} × {item}. Steuer {amount} ISK.',
    reversal:'Zahlung für NPC-Verkauf rückgängig gemacht: {quantity} × {item}. Zurückgezahlt: {amount} ISK.',
    refund:'Steuer auf NPC-Verkauf erstattet: {quantity} × {item}. Erstattung: {amount} ISK.'},
  ES:{sale:'Venta a NPC: {quantity} × {item} a {price} ISK por unidad. Bruto {gross} ISK; impuestos {tax} ISK; neto {net} ISK.',
    cancelled:'Pago por venta a NPC (revertido): {quantity} × {item}. Pago original: {gross} ISK.',
    pending:'Pago por venta a NPC: {quantity} × {item} a {price} ISK por unidad. Bruto {gross} ISK. Liquidación pendiente.',
    tax:'Impuestos por venta a NPC: {quantity} × {item}. Impuestos {amount} ISK.',
    reversal:'Pago por venta a NPC revertido: {quantity} × {item}. Devuelto: {amount} ISK.',
    refund:'Impuestos por venta a NPC reembolsados: {quantity} × {item}. Reembolso: {amount} ISK.'},
  FR:{sale:'Vente à un PNJ : {quantity} × {item} à {price} ISK l’unité. Brut {gross} ISK ; taxe {tax} ISK ; net {net} ISK.',
    cancelled:'Paiement pour vente à un PNJ (annulé) : {quantity} × {item}. Paiement initial : {gross} ISK.',
    pending:'Paiement pour vente à un PNJ : {quantity} × {item} à {price} ISK l’unité. Brut {gross} ISK. Règlement en attente.',
    tax:'Taxe sur vente à un PNJ : {quantity} × {item}. Taxe {amount} ISK.',
    reversal:'Paiement pour vente à un PNJ annulé : {quantity} × {item}. Somme restituée : {amount} ISK.',
    refund:'Taxe sur vente à un PNJ remboursée : {quantity} × {item}. Remboursement : {amount} ISK.'},
  JA:{sale:'NPCへの売却：{quantity} × {item}、単価 {price} ISK。総額 {gross} ISK、税金 {tax} ISK、手取り {net} ISK。',
    cancelled:'NPCへの売却代金（取り消し済み）：{quantity} × {item}。元の支払額 {gross} ISK。',
    pending:'NPCへの売却代金：{quantity} × {item}、単価 {price} ISK。総額 {gross} ISK。決済処理中。',
    tax:'NPCへの売却税：{quantity} × {item}。税金 {amount} ISK。',
    reversal:'NPCへの売却代金の取り消し：{quantity} × {item}。返還額 {amount} ISK。',
    refund:'NPCへの売却税の払い戻し：{quantity} × {item}。返金額 {amount} ISK。'},
  KO:{sale:'NPC 판매: {quantity} × {item}, 개당 {price} ISK. 총액 {gross} ISK, 세금 {tax} ISK, 순수익 {net} ISK.',
    cancelled:'NPC 판매 대금(취소됨): {quantity} × {item}. 원래 지급액 {gross} ISK.',
    pending:'NPC 판매 대금: {quantity} × {item}, 개당 {price} ISK. 총액 {gross} ISK. 정산 대기 중.',
    tax:'NPC 판매세: {quantity} × {item}. 세금 {amount} ISK.',
    reversal:'NPC 판매 대금 취소: {quantity} × {item}. 반환액 {amount} ISK.',
    refund:'NPC 판매세 환급: {quantity} × {item}. 환급액 {amount} ISK.'},
  RU:{sale:'Продажа NPC: {quantity} × {item} по {price} ISK за единицу. До налога: {gross} ISK; налог: {tax} ISK; чистый доход: {net} ISK.',
    cancelled:'Оплата продажи NPC (отменена): {quantity} × {item}. Первоначальная оплата: {gross} ISK.',
    pending:'Оплата продажи NPC: {quantity} × {item} по {price} ISK за единицу. До налога: {gross} ISK. Расчёт ещё не завершён.',
    tax:'Налог на продажу NPC: {quantity} × {item}. Налог: {amount} ISK.',
    reversal:'Оплата продажи NPC отменена: {quantity} × {item}. Возвращено: {amount} ISK.',
    refund:'Налог на продажу NPC возмещён: {quantity} × {item}. Возмещение: {amount} ISK.'},
  ZH:{sale:'售予NPC：{quantity} × {item}，单价 {price} ISK。税前收入 {gross} ISK；税费 {tax} ISK；净收入 {net} ISK。',
    cancelled:'NPC销售款（已撤销）：{quantity} × {item}。原付款 {gross} ISK。',
    pending:'NPC销售款：{quantity} × {item}，单价 {price} ISK。税前收入 {gross} ISK。等待结算。',
    tax:'NPC销售税：{quantity} × {item}。税费 {amount} ISK。',
    reversal:'NPC销售款已撤销：{quantity} × {item}。退回金额 {amount} ISK。',
    refund:'NPC销售税已退还：{quantity} × {item}。退款 {amount} ISK。'},
};
const cents=value=>Math.round(Number(value)*100);
const legPattern=/^(npc-market:.+):wallet:(seller-credit|tax-debit|seller-compensate|tax-compensate)$/;

function createWalletBatching({clock=Date.now,log=console}={}) {
  const commands=new AsyncLocalStorage(),readers=new AsyncLocalStorage();
  let db=null,nativeOperations=false;
  const pending=new Map(); // session -> wallet -> final native notification
  function attach(store) {
    if(db&&db!==store.db)throw Error('NPC wallet batching already bound');
    db=store.db;
    db.exec(`CREATE TABLE IF NOT EXISTS nm_wallet_batches (
      batch_id TEXT PRIMARY KEY,state TEXT NOT NULL,started_at INTEGER NOT NULL,finished_at INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS nm_wallet_one_open_batch ON nm_wallet_batches(state) WHERE state='open';
      CREATE TABLE IF NOT EXISTS nm_wallet_batch_operations (
        operation_key TEXT PRIMARY KEY,batch_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nm_wallet_batch_segments (
        segment_id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id TEXT NOT NULL,
        owner_id INTEGER NOT NULL,is_corp INTEGER NOT NULL,account_key INTEGER NOT NULL,
        net_cents INTEGER NOT NULL,gross_cents INTEGER NOT NULL,tax_cents INTEGER NOT NULL,
        sales INTEGER NOT NULL,last_balance_cents INTEGER NOT NULL,anchor_json TEXT NOT NULL,
        closed INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS nm_wallet_segments_owner ON nm_wallet_batch_segments(owner_id,is_corp,account_key,segment_id);
      CREATE TABLE IF NOT EXISTS nm_wallet_batch_entries (
        command_key TEXT PRIMARY KEY,segment_id INTEGER NOT NULL,journal_id TEXT NOT NULL,
        owner_id INTEGER NOT NULL,is_corp INTEGER NOT NULL,amount_cents INTEGER NOT NULL,leg TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS nm_wallet_entries_journal ON nm_wallet_batch_entries(owner_id,is_corp,journal_id);
      CREATE TABLE IF NOT EXISTS nm_wallet_sale_entries (
        command_key TEXT PRIMARY KEY,operation_key TEXT NOT NULL,journal_id TEXT NOT NULL,
        owner_id INTEGER NOT NULL,is_corp INTEGER NOT NULL,account_key INTEGER NOT NULL,
        amount_cents INTEGER NOT NULL,leg TEXT NOT NULL,details_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS nm_wallet_sales_journal ON nm_wallet_sale_entries(owner_id,is_corp,journal_id);`);
  }
  function activeBatch(){return db?.prepare("SELECT batch_id FROM nm_wallet_batches WHERE state='open'").get()?.batch_id;}
  function tagOperation(key,offline) {
    if(!db||!offline)return;
    const old=db.prepare('SELECT batch_id FROM nm_wallet_batch_operations WHERE operation_key=?').get(key);
    if(old)return old.batch_id;
    return db.transaction(()=>{
      const id=activeBatch()||randomUUID();
      db.prepare("INSERT OR IGNORE INTO nm_wallet_batches VALUES (?,'open',?,NULL)").run(id,clock());
      db.prepare('INSERT INTO nm_wallet_batch_operations VALUES (?,?)').run(key,id);
      return id;
    })();
  }
  function scopeFor(key,ownerID,isCorp,accountKey) {
    const match=legPattern.exec(String(key||''));
    if(!db||!match)return null;
    const batch=db.prepare('SELECT batch_id FROM nm_wallet_batch_operations WHERE operation_key=?').get(match[1]);
    const scope={key,operationKey:match[1],leg:match[2],batchID:batch?.batch_id,ownerID:Number(ownerID),isCorp,accountKey:Number(accountKey)||1000};
    if(batch)return scope;
    // The native bridge persists this purchase before executing any wallet
    // leg. A matching prefix alone is not evidence of an owned purchase.
    nativeOperations=nativeOperations||Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='nm_native_ops'").get());
    if(!nativeOperations)return null;
    const op=db.prepare('SELECT order_json,quantity FROM nm_native_ops WHERE operation_key=?').get(match[1]);
    if(!op)return null;
    const order=JSON.parse(op.order_json);
    if(Number(order.ownerID)!==scope.ownerID||Boolean(order.isCorp)!==isCorp||(Number(order.accountKey)||1000)!==scope.accountKey)return null;
    if(!Number.isSafeInteger(order.typeID)||order.typeID<=0||!Number.isSafeInteger(op.quantity)||op.quantity<=0||!Number.isSafeInteger(cents(order.price))||order.price<=0)return null;
    return {...scope,details:{typeID:order.typeID,quantity:op.quantity,priceCents:cents(order.price)}};
  }
  function record(scope,result) {
    if(!result?.success||result.fingerprintMismatch)return;
    const entry=scope.isCorp?result.data?.journalEntry:result.journalEntry;
    if(!entry||!entry.transactionID)throw Error('NPC wallet summary requires the native journal receipt');
    const amount=cents(entry.amount),balance=cents(entry.balance);
    if(!Number.isSafeInteger(amount)||!Number.isSafeInteger(balance))throw Error('NPC wallet summary precision exceeded');
    if(!scope.batchID){
      const accountKey=Number(entry.accountKey)||1000;
      if(accountKey!==scope.accountKey)throw Error('NPC wallet sale division mismatch');
      const duplicate=db.prepare('SELECT * FROM nm_wallet_sale_entries WHERE command_key=?').get(scope.key);
      if(duplicate){
        if(duplicate.journal_id!==String(entry.transactionID)||duplicate.owner_id!==scope.ownerID||Boolean(duplicate.is_corp)!==scope.isCorp||duplicate.account_key!==accountKey||duplicate.amount_cents!==amount)
          throw Error('NPC wallet sale receipt mismatch');
        return;
      }
      db.prepare('INSERT INTO nm_wallet_sale_entries VALUES (?,?,?,?,?,?,?,?,?)')
        .run(scope.key,scope.operationKey,String(entry.transactionID),scope.ownerID,scope.isCorp?1:0,accountKey,amount,scope.leg,JSON.stringify(scope.details));
      return;
    }
    db.transaction(()=>{
      const duplicate=db.prepare('SELECT * FROM nm_wallet_batch_entries WHERE command_key=?').get(scope.key);
      if(duplicate){
        if(duplicate.journal_id!==String(entry.transactionID)||duplicate.owner_id!==scope.ownerID||Boolean(duplicate.is_corp)!==scope.isCorp||duplicate.amount_cents!==amount)
          throw Error('NPC wallet summary receipt mismatch');
        return;
      }
      const accountKey=Number(entry.accountKey)||scope.accountKey;
      let segment=db.prepare(`SELECT * FROM nm_wallet_batch_segments WHERE owner_id=? AND is_corp=? AND account_key=? ORDER BY segment_id DESC LIMIT 1`)
        .get(scope.ownerID,scope.isCorp?1:0,accountKey);
      // Do not cross unrelated balance changes, batch boundaries or journal
      // month filters. Compensation legs stay in the same net-income summary.
      const monthOf=e=>new Date(Number((BigInt(e.transactionDate||0)-116444736000000000n)/10000n)).toISOString().slice(0,7);
      if(!segment||segment.closed||segment.batch_id!==scope.batchID||segment.last_balance_cents!==balance-amount||
        monthOf(JSON.parse(segment.anchor_json))!==monthOf(entry)) {
        const id=db.prepare(`INSERT INTO nm_wallet_batch_segments(batch_id,owner_id,is_corp,account_key,
          net_cents,gross_cents,tax_cents,sales,last_balance_cents,anchor_json) VALUES (?,?,?,?,0,0,0,0,?,?)`)
          .run(scope.batchID,scope.ownerID,scope.isCorp?1:0,accountKey,balance-amount,JSON.stringify(entry)).lastInsertRowid;
        segment={segment_id:id};
      }
      const sale=scope.leg==='seller-credit'?1:scope.leg==='seller-compensate'?-1:0;
      const gross=scope.leg.startsWith('seller-')?amount:0,tax=scope.leg.startsWith('tax-')?-amount:0;
      db.prepare(`INSERT INTO nm_wallet_batch_entries VALUES (?,?,?,?,?,?,?)`)
        .run(scope.key,segment.segment_id,String(entry.transactionID),scope.ownerID,scope.isCorp?1:0,amount,scope.leg);
      db.prepare(`UPDATE nm_wallet_batch_segments SET net_cents=net_cents+?,gross_cents=gross_cents+?,
        tax_cents=tax_cents+?,sales=sales+?,last_balance_cents=?,anchor_json=? WHERE segment_id=?`)
        .run(amount,gross,tax,sale,balance,JSON.stringify(entry),segment.segment_id);
    })();
  }
  async function command(key,ownerID,isCorp,accountKey,action) {
    const scope=scopeFor(key,ownerID,isCorp,accountKey);
    if(!scope)return action();
    return commands.run(scope,async()=>{const result=await action();record(scope,result);return result;});
  }
  const walletKey=(isCorp,ownerID,account)=>`${isCorp?1:0}:${ownerID}:${account}`;
  function deliver(session,item,current=true) {
    if(typeof session.sendNotification!=='function'||session.socket?.destroyed)return;
    if(item.isCorp?Number(session.corporationID||session.corpid)!==item.ownerID:Number(session.characterID||session.userid)!==item.ownerID)return;
    try{session.sendNotification('OnAccountChange',item.idType,current?item.readCurrent():item.args);}
    catch(error){log.error?.('[NPC Market Buyers] Wallet summary notification failed: '+error.message);}
  }
  function sendNotification(session,idType,args,readCurrent,isCorp=false) {
    const scope=commands.getStore(),ownerID=Number(args[1]),key=walletKey(isCorp,ownerID,args[0]);
    if(scope?.batchID&&scope.isCorp===isCorp&&scope.ownerID===ownerID&&args[0]===(scope.accountKey===1000?'cash':`cash${scope.accountKey-999}`)) {
      if(!pending.has(session))pending.set(session,new Map());
      pending.get(session).set(key,{idType,args,readCurrent,isCorp,ownerID});
      return;
    }
    // A real user operation must remain visible immediately. Finish the
    // preceding chunk first so the client sees its correct balance delta.
    const queued=pending.get(session)?.get(key);
    if(queued){pending.get(session).delete(key);deliver(session,queued,false);}
    if(!pending.get(session)?.size)pending.delete(session);
    if(db&&/^cash(?:[2-7])?$/.test(args[0]))db.prepare('UPDATE nm_wallet_batch_segments SET closed=1 WHERE owner_id=? AND is_corp=? AND account_key=? AND closed=0')
      .run(ownerID,isCorp?1:0,args[0]==='cash'?1000:999+Number(String(args[0]).slice(4)));
    return session.sendNotification('OnAccountChange',idType,args);
  }
  function flush() {
    const snapshot=[...pending];pending.clear();
    for(const [session,items] of snapshot)for(const item of items.values())deliver(session,item);
  }
  function finish() {
    if(db)db.transaction(()=>{
      db.prepare("UPDATE nm_wallet_batch_segments SET closed=1 WHERE batch_id IN (SELECT batch_id FROM nm_wallet_batches WHERE state='open')").run();
      db.prepare("UPDATE nm_wallet_batches SET state='finished',finished_at=? WHERE state='open'").run(clock());
    })();
    flush();
  }
  function describe({sales,gross_cents,tax_cents},language) {
    const lang=String(language||'EN').toUpperCase(),fmt=new Intl.NumberFormat(locales[lang]||locales.EN,{minimumFractionDigits:2,maximumFractionDigits:2});
    const values={sales:String(Math.max(0,sales)),gross:fmt.format(gross_cents/100),tax:fmt.format(tax_cents/100)};
    return (summaries[lang]||summaries.EN).replace(/\{(sales|gross|tax)\}/g,(_,key)=>values[key]);
  }
  function journal(rows,{ownerID,isCorp=false}={}) {
    const reader=readers.getStore();
    if(!db||!reader||!Array.isArray(rows)||!rows.length)return rows;
    const mapped=new Map(),segments=new Map(),sales=new Map(),operations=new Map();
    // Query only native-visible IDs; an indexed lookup avoids scanning years
    // of mod history on every Wallet refresh.
    for(let start=0;start<rows.length;start+=400){
      const ids=rows.slice(start,start+400).map(row=>String(row.transactionID));
      for(const entry of db.prepare(`SELECT * FROM nm_wallet_batch_entries WHERE owner_id=? AND is_corp=? AND journal_id IN (${ids.map(()=>'?').join(',')})`)
        .all(Number(ownerID),isCorp?1:0,...ids))mapped.set(entry.journal_id,entry);
      for(const entry of db.prepare(`SELECT * FROM nm_wallet_sale_entries WHERE owner_id=? AND is_corp=? AND journal_id IN (${ids.map(()=>'?').join(',')})`)
        .all(Number(ownerID),isCorp?1:0,...ids))sales.set(entry.journal_id,entry);
    }
    function online(row){
      const sale=sales.get(String(row.transactionID));
      if(!sale||sale.account_key!==(Number(row.accountKey)||1000)||sale.amount_cents!==cents(row.amount))return row;
      if(!operations.has(sale.operation_key))operations.set(sale.operation_key,db.prepare('SELECT state,result_json FROM nm_native_ops WHERE operation_key=?').get(sale.operation_key));
      const op=operations.get(sale.operation_key),details=JSON.parse(sale.details_json);
      const result=op?.result_json?JSON.parse(op.result_json):null,tax=result?cents(result.taxISK):NaN;
      const settled=op?.state==='settled'&&Number.isSafeInteger(tax)&&tax>=0&&tax<=sale.amount_cents;
      const kind=sale.leg==='seller-credit'?(settled?'sale':op?.state==='rejected'?'cancelled':'pending'):sale.leg==='tax-debit'?'tax':sale.leg==='seller-compensate'?'reversal':'refund';
      const lang=String(reader.language||'EN').toUpperCase(),fmt=new Intl.NumberFormat(locales[lang]||locales.EN,{minimumFractionDigits:2,maximumFractionDigits:2});
      const values={quantity:new Intl.NumberFormat(locales[lang]||locales.EN).format(details.quantity),price:fmt.format(details.priceCents/100),
        gross:fmt.format(sale.amount_cents/100),tax:fmt.format(tax/100),net:fmt.format((sale.amount_cents-tax)/100),amount:fmt.format(Math.abs(sale.amount_cents)/100)};
      const text=(saleDescriptions[lang]||saleDescriptions.EN)[kind].replace(/\{(quantity|price|gross|tax|net|amount)\}/g,(_,key)=>values[key]);
      return {...row,description:JSON.stringify({npcMarketBuyersSale:{version:1,typeID:details.typeID,text}})};
    }
    const chunks=[];
    for(const row of rows){
      const entry=mapped.get(String(row.transactionID)),last=chunks[chunks.length-1];
      if(entry&&last?.segmentID===entry.segment_id)last.items.push({row,entry});
      else chunks.push({segmentID:entry?.segment_id,items:[{row,entry}]});
    }
    const counts=new Map();for(const chunk of chunks)if(chunk.segmentID)counts.set(chunk.segmentID,(counts.get(chunk.segmentID)||0)+1);
    return chunks.flatMap(chunk=>{
      if(!chunk.segmentID)return chunk.items.map(item=>online(item.row));
      if(!segments.has(chunk.segmentID))segments.set(chunk.segmentID,db.prepare('SELECT * FROM nm_wallet_batch_segments WHERE segment_id=?').get(chunk.segmentID));
      const segment=segments.get(chunk.segmentID),anchor=JSON.parse(segment.anchor_json);
      const hasAnchor=chunk.items.some(({row})=>String(row.transactionID)===String(anchor.transactionID));
      let totals=segment;
      if(!hasAnchor||counts.get(chunk.segmentID)>1){
        totals={net_cents:0,gross_cents:0,tax_cents:0,sales:0};
        for(const {entry} of chunk.items){totals.net_cents+=entry.amount_cents;
          if(entry.leg.startsWith('seller-')){totals.gross_cents+=entry.amount_cents;totals.sales+=entry.leg==='seller-credit'?1:-1;}
          else totals.tax_cents-=entry.amount_cents;}
      }
      // A summary can outlive native journal trimming (1000 raw rows), provided
      // its latest native anchor is still visible. Nothing is inserted twice.
      const latest=hasAnchor?anchor:chunk.items.reduce((a,b)=>BigInt(a.row.transactionDate)>BigInt(b.row.transactionDate)?a:b).row;
      return [{...latest,entryTypeID:2,amount:totals.net_cents/100,
        description:JSON.stringify({npcMarketBuyersOfflineSummary:{version:1,text:describe(totals,reader.language)}})}];
    });
  }
  function installWallet(wallet,isCorp=false) {
    const name=isCorp?'adjustCorporationWalletDivisionBalanceAsync':'adjustCharacterBalanceAsync';
    const original=wallet[name],prefix=isCorp?'getCorporationWallet':'getCharacterWallet';
    if(typeof original!=='function'||['Journal','Transactions'].some(suffix=>typeof wallet[prefix+suffix]!=='function'))throw Error('NPC wallet batching exports unavailable');
    wallet[name]=function(...args){const metadata=args[isCorp?4:3]||{};
      return command(metadata.commandID,args[0],isCorp,isCorp?args[1]:1000,()=>original.apply(this,args));};
    for(const suffix of ['Journal','Transactions']){
      const getter=wallet[prefix+suffix];
      wallet[prefix+suffix]=function(...args){return journal(getter.apply(this,args),{ownerID:args[0],isCorp});};
    }
  }
  function installAccountService(Service) {
    for(const name of ['Handle_GetJournal','Handle_GetJournalForAccounts','Handle_GetTransactions']){
      const original=Service.prototype[name];if(typeof original!=='function')throw Error('NPC wallet journal service seam unavailable');
      Service.prototype[name]=function(args,session,...rest){return readers.run({language:session?.languageID||'EN'},()=>original.call(this,args,session,...rest));};
    }
  }
  return {attach,tagOperation,activeBatch,command,sendNotification,flush,finish,journal,describe,installWallet,installAccountService,
    read: (language,action)=>readers.run({language},action)};
}

function prepareWalletSource(source,isCorp=false) {
  source=String(source).replace(/\r\n/g,'\n');
  if(source.includes('__npcMarketWalletBatching'))throw Error('NPC wallet notification bridge already installed');
  const needle=isCorp?`    session.sendNotification("OnAccountChange", "*corpid&corpAccountKey", [
      accountKeyName,
      Number(corporationID),
      buildMarshalRealMoney(balance, 0),
    ]);`:`  session.sendNotification("OnAccountChange", "clientID", [
    accountKey,
    ownerID,
    buildMarshalRealMoney(balance, 0),
  ]);`;
  if(source.split(needle).length!==2)throw Error('NPC wallet notification seam changed');
  const replacement=isCorp?`    __npcMarketWalletBatching.sendNotification(session, "*corpid&corpAccountKey", [
      accountKeyName, Number(corporationID), buildMarshalRealMoney(balance, 0),
    ], () => [accountKeyName, Number(corporationID), buildMarshalRealMoney(getCorporationWalletBalance(corporationID, accountKey), 0)], true);`:
    `  __npcMarketWalletBatching.sendNotification(session, "clientID", [
    accountKey, ownerID, buildMarshalRealMoney(balance, 0),
  ], () => [accountKey, ownerID, buildMarshalRealMoney(accountKey === ACCOUNT_KEY_NAME.CASH ? getCharacterWallet(ownerID).balance : balance, 0)]);`;
  const result=`"use strict";\nconst __npcMarketWalletBatching = require(${JSON.stringify(path.join(__dirname,'walletBatching.js'))}).shared;\n`+source.replace(needle,replacement);
  new vm.Script(result);return result;
}
const shared=createWalletBatching();
module.exports={createWalletBatching,prepareWalletSource,shared,summaries,saleDescriptions};
