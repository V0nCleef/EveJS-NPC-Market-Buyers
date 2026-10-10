"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createWalletBatching,prepareWalletSource,summaries,saleDescriptions}=require('../lib/walletBatching');
const {createNativeBridge}=require('../lib/settlement');
const {createStore}=require('../lib/store'),{createEngine}=require('../lib/engine'),{DEFAULTS}=require('../lib/config'),{evaluate}=require('../lib/policy');
const root=path.resolve(process.env.EVEJS_TEST_ROOT||path.join(__dirname,'../../EveJS-v0.12.9')),Database=require(path.join(root,'server/node_modules/better-sqlite3'));
const personalSource=prepareWalletSource(fs.readFileSync(path.join(root,'server/src/services/account/walletState.js'),'utf8'));
const corpSource=prepareWalletSource(fs.readFileSync(path.join(root,'server/src/services/corporation/corpWalletState.js'),'utf8'),true);
function extract(source,name){const match=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(source);assert.ok(match,name);
  const tail=source.slice(match.index),next=/\n(?:async )?function [A-Za-z]/.exec(tail);return next?tail.slice(0,next.index):tail;}
function fixture(t,{isCorp=false,cap=1000}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'npc-wallet-batch-')),filename=path.join(dir,'mod.sqlite');
  let store=createStore(filename,{Database}),batch=createWalletBatching(),sequence=0,time=Date.UTC(2026,9,10),lostReply=null;
  batch.attach(store);
  createNativeBridge({}).attach(store);
  const wallets=new Map(),receipts=new Map(),sessions=[],notifications=[];
  function wallet(owner,account=1000){const key=`${owner}:${account}`;
    if(!wallets.has(key))wallets.set(key,{balance:1000,rows:[]});return wallets.get(key);}
  const context={__npcMarketWalletBatching:batch,sessionRegistry:{getSessions:()=>sessions},
    normalizeMoney:n=>Number(n),buildMarshalRealMoney:n=>n,ACCOUNT_KEY_NAME:{CASH:'cash'},
    WALLET_COMMAND_TYPE:{CHARACTER_ADJUST_ISK:'personal',CORPORATION_ADJUST_ISK:'corporation'},
    getCharacterWallet:owner=>({balance:wallet(owner).balance,aurBalance:0,plexBalance:0,balanceChange:0}),
    getCorporationWalletBalance:(owner,account)=>wallet(owner,account).balance,
    getCorporationWalletKeyName:key=>key===1000?'cash':`cash${key-999}`,
    executeWalletCommandAsync:async(_type,input,metadata)=>{
      const key=metadata.commandID||`normal-${++sequence}`;
      if(receipts.has(key))return {...receipts.get(key),duplicate:true};
      const amount=input.amount??input.delta,state=wallet(input.charId??input.corporationID,input.accountKey||1000);
      state.balance=Math.round((state.balance+amount)*100)/100;
      const journalEntry={transactionID:++sequence,transactionDate:String(BigInt(time++)*10000n+116444736000000000n),
        entryTypeID:amount>0?2:54,accountKey:input.accountKey||1000,ownerID1:1,ownerID2:2,amount,balance:state.balance,description:'native',currency:1};
      state.rows.unshift(journalEntry);state.rows.splice(cap);
      const result=isCorp?{success:true,data:{corporationID:input.corporationID,accountKey:input.accountKey,balance:state.balance,delta:amount,journalEntry}}:
        {success:true,data:{balance:state.balance,aurBalance:0,plexBalance:0,balanceChange:amount},journalEntry};
      receipts.set(key,result);
      if(lostReply===key){lostReply=null;throw Error('lost native reply after commit');}
      return result;
    }};
  vm.createContext(context);
  const names=isCorp?['notifyCorporationWalletChange','isCollidedWalletReplay','resolveAnnouncedDivisionBalance','adjustCorporationWalletDivisionBalanceAsync']:
    ['syncWalletToSession','emitAccountChangeToSession','notifyCharacterWalletChange','resolveAnnouncedCharacterWallet','announceCharacterIskResult','adjustCharacterBalanceAsync'];
  vm.runInContext(names.map(name=>extract(isCorp?corpSource:personalSource,name)).join('\n'),context);
  const native={};
  function install(){
    context.__npcMarketWalletBatching=batch;
    native[isCorp?'adjustCorporationWalletDivisionBalanceAsync':'adjustCharacterBalanceAsync']=context[isCorp?'adjustCorporationWalletDivisionBalanceAsync':'adjustCharacterBalanceAsync'];
    native[isCorp?'getCorporationWalletJournal':'getCharacterWalletJournal']=(owner,options={})=>wallet(owner,options.accountKey||1000).rows.map(row=>({...row}));
    native[isCorp?'getCorporationWalletTransactions':'getCharacterWalletTransactions']=(owner,options={})=>wallet(owner,options.accountKey||1000).rows.map(row=>({...row}));
    batch.installWallet(native,isCorp);
  }
  install();
  function session(id=2){const value={characterID:id,corporationID:id,languageID:'EN',socket:{destroyed:false},sendNotification:(...args)=>notifications.push({session:value,args})};sessions.push(value);return value;}
  async function adjust(amount,key,owner=2,account=1000){const metadata=key?{commandID:key}:{},options={description:'native',idempotencyKey:key};
    return isCorp?native.adjustCorporationWalletDivisionBalanceAsync(owner,account,amount,options,metadata):native.adjustCharacterBalanceAsync(owner,amount,options,metadata);}
  async function purchase(index,{gross=100,tax=8,offline=true,owner=2,account=1000,typeID=241,quantity=10}={}){
    const key=`npc-market:900000:${owner}:${index}:60003760`;
    const order={orderID:String(index),ownerID:owner,isCorp,accountKey:account,typeID,price:gross/quantity};
    store.db.prepare('INSERT OR IGNORE INTO nm_native_ops VALUES (?,?,?,?,?,?,?,?)')
      .run(key,'fixture','pending',JSON.stringify(order),quantity,null,null,time);
    batch.tagOperation(key,offline);
    await adjust(gross,key+':wallet:seller-credit',owner,account);
    if(tax)await adjust(-tax,key+':wallet:tax-debit',owner,account);
    store.db.prepare("UPDATE nm_native_ops SET state='settled',result_json=? WHERE operation_key=?")
      .run(JSON.stringify({quantity,grossISK:gross,taxISK:tax}),key);
    return key;
  }
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {native,receipts,sessions,notifications,session,adjust,purchase,get rows(){return wallet(2).rows;},get batch(){return batch;},get store(){return store;},get balance(){return wallet(2).balance;},
    read:(lang,owner=2,account=1000)=>batch.read(lang,()=>native[isCorp?'getCorporationWalletJournal':'getCharacterWalletJournal'](owner,{accountKey:account})),
    loseNextReply:key=>{lostReply=key;},
    reopen(){batch.flush();store.close();store=createStore(filename,{Database});batch=createWalletBatching();batch.attach(store);install();}};
}

test('notification transforms compose with incoming native source and fail at changed owned seams',()=>{
  for(const [file,corp] of [['account/walletState.js',false],['corporation/corpWalletState.js',true]]){
    const source=fs.readFileSync(path.join(root,'server/src/services',file),'utf8');
    const transformed=prepareWalletSource('// other mod\n'+source,corp);new vm.Script(transformed);
    assert.ok(transformed.includes('// other mod'));assert.throws(()=>prepareWalletSource(transformed,corp),/already installed/);
    assert.throws(()=>prepareWalletSource(source.replace('session.sendNotification("OnAccountChange"','session.changed("OnAccountChange"'),corp),/seam changed/);
  }
});
test('actual native wallet functions: 60 offline sales produce one net popup and one journal summary',async t=>{
  const f=fixture(t),client=f.session();
  for(let i=0;i<60;i++)await f.purchase(i);
  assert.equal(f.notifications.length,0);assert.equal(client.balance,f.balance);assert.equal(f.rows.length,120);
  f.batch.finish();assert.equal(f.notifications.length,1);assert.equal(f.notifications[0].args[2][2],6520);
  const result=f.read('EN');assert.equal(result.length,1);assert.equal(result[0].amount,5520);assert.equal(result[0].balance,6520);
  assert.match(result[0].description,/60 purchases.*6,000.00 ISK; tax 480.00/);
  assert.equal(f.native.getCharacterWalletJournal(2).length,120,'non-UI callers retain the native journal');
});
test('summary survives restart and idempotent native receipt replay without new income',async t=>{
  const f=fixture(t);f.session();const key=await f.purchase(1),batch=f.batch.activeBatch();f.reopen();
  assert.equal(f.batch.activeBatch(),batch);
  await f.adjust(100,key+':wallet:seller-credit');await f.adjust(-8,key+':wallet:tax-debit');await f.purchase(2);
  f.batch.finish();assert.equal(f.balance,1184);assert.equal(f.rows.length,4);
  assert.equal(f.read('EN').length,1);assert.equal(f.read('EN')[0].amount,184);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM nm_wallet_batch_entries').get().n,4);
});
test('normal wallet actions and online sales stay immediate and keep their own history',async t=>{
  const f=fixture(t);f.session();await f.purchase(1);await f.adjust(-25);await f.purchase(2);f.batch.finish();
  assert.deepEqual(f.notifications.map(n=>n.args[2][2]),[1092,1067,1159]);
  assert.deepEqual(f.read('EN').map(row=>[row.amount,row.balance]),[[92,1159],[-25,1067],[92,1092]]);
  f.notifications.length=0;await f.purchase(3,{offline:false});assert.equal(f.notifications.length,2);
  assert.equal(f.read('EN').length,5);
});
test('online sales describe exact item quantities and actual tax without changing native amounts or notification timing',async t=>{
  const f=fixture(t);f.session();await f.purchase(1,{offline:false,gross:1404,tax:112.32,quantity:156});
  assert.equal(f.notifications.length,2);assert.equal(f.batch.activeBatch(),undefined);
  const rows=f.read('EN');assert.equal(rows.length,2);
  assert.deepEqual(rows.map(row=>[row.entryTypeID,row.amount,row.balance]),[[54,-112.32,2291.68],[2,1404,2404]]);
  const credit=JSON.parse(rows[1].description).npcMarketBuyersSale,tax=JSON.parse(rows[0].description).npcMarketBuyersSale;
  assert.equal(credit.typeID,241);assert.match(credit.text,/156 × \{item\} at 9.00 ISK each.*1,404.00 ISK; tax 112.32 ISK; net 1,291.68 ISK/);
  assert.match(tax.text,/156 × \{item\}.*112.32 ISK/);
  assert.ok(f.native.getCharacterWalletTransactions(2).every(row=>row.description==='native'));
  const before=f.read('EN');f.reopen();await f.purchase(1,{offline:false,gross:1404,tax:112.32,quantity:156});
  assert.equal(f.balance,2291.68);assert.equal(f.rows.length,2);assert.deepEqual(f.read('EN'),before);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM nm_wallet_sale_entries').get().n,2);
});
test('online descriptions cover all eight languages and keep unknown or unrelated receipts native',async t=>{
  const f=fixture(t);await f.purchase(1,{offline:false});await f.adjust(50,'npc-market:unowned:wallet:seller-credit');await f.adjust(20);
  for(const language of ['EN','DE','ES','FR','JA','KO','RU','ZH']){
    assert.deepEqual(Object.keys(saleDescriptions[language]).sort(),['cancelled','pending','refund','reversal','sale','tax']);
    const rows=f.read(language);assert.equal(rows[0].description,'native');assert.equal(rows[1].description,'native');
    for(const row of rows.slice(2)){
      const data=JSON.parse(row.description).npcMarketBuyersSale;assert.equal(data.typeID,241);
      assert.equal((data.text.match(/\{item\}/g)||[]).length,1);assert.ok(!/\{(?:quantity|price|gross|tax|net|amount)\}/.test(data.text));
      if(language!=='EN')assert.notEqual(data.text,JSON.parse(f.read('EN')[rows.indexOf(row)].description).npcMarketBuyersSale.text);
    }
  }
});
test('online lost replies recover exact receipts; incomplete settlements and reversals have honest descriptions',async t=>{
  const f=fixture(t);f.session();const key='npc-market:900000:2:1:60003760';
  f.loseNextReply(key+':wallet:tax-debit');await assert.rejects(f.purchase(1,{offline:false}),/lost native reply/);
  let rows=f.read('EN');assert.equal(rows.length,2);assert.equal(rows[0].description,'native','unacknowledged tax has no guessed mapping');
  assert.match(rows[1].description,/Settlement pending/);assert.ok(!rows[1].description.includes('net '));
  f.reopen();await f.purchase(1,{offline:false});assert.equal(f.balance,1092);assert.equal(f.rows.length,2);
  assert.match(f.read('EN')[1].description,/net 92.00 ISK/);
  await f.adjust(8,key+':wallet:tax-compensate');await f.adjust(-100,key+':wallet:seller-compensate');
  f.store.db.prepare("UPDATE nm_native_ops SET state='rejected' WHERE operation_key=?").run(key);
  rows=f.read('EN');assert.match(rows[0].description,/payment reversed.*100.00 ISK/);assert.match(rows[1].description,/tax refunded.*8.00 ISK/);
  assert.match(rows[3].description,/payment \(reversed\)/);assert.ok(!rows[3].description.includes('Settlement pending'));
  assert.equal(f.balance,1000);assert.equal(f.notifications.length,5,'the lost native reply emitted no notification');
});
test('online descriptions isolate corporation divisions and reject mismatching journal receipts',async t=>{
  const f=fixture(t,{isCorp:true});f.session();await f.purchase(1,{offline:false,account:1001});await f.purchase(2,{offline:false,owner:3});
  assert.equal(f.read('EN').length,0);assert.equal(f.read('EN',2,1001).length,2);assert.equal(f.read('EN',3).length,2);
  const native=f.native.getCorporationWalletTransactions(2,{accountKey:1001});
  const wrongAmount={...native[1],amount:101},wrongDivision={...native[1],accountKey:1000};
  for(const row of [wrongAmount,wrongDivision])assert.equal(f.batch.read('EN',()=>f.batch.journal([row],{ownerID:2,isCorp:true}))[0].description,'native');
  await assert.rejects(f.batch.command('npc-market:900000:2:1:60003760:wallet:seller-credit',2,true,1001,
    async()=>({success:true,data:{journalEntry:{...native[1],transactionID:999}}})),/receipt mismatch/);
  await f.adjust(1,'npc-market:900000:2:1:60003760:wallet:seller-credit',3,1000);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM nm_wallet_sale_entries').get().n,4,'another owner cannot claim this operation');
});
test('compensated fills sum to zero instead of claiming a sale or keeping tax',async t=>{
  const f=fixture(t);f.session();const key=await f.purchase(1);
  await f.adjust(8,key+':wallet:tax-compensate');await f.adjust(-100,key+':wallet:seller-compensate');f.batch.finish();
  const result=f.read('EN');assert.equal(result.length,1);assert.equal(result[0].amount,0);assert.equal(result[0].balance,1000);
  assert.match(result[0].description,/0 purchases.*0.00 ISK; tax 0.00/);
});
test('coalescing isolates wallet owners, connected clients and corporation divisions',async t=>{
  const f=fixture(t,{isCorp:true}),a=f.session(2),b=f.session(2),other=f.session(3);
  await f.purchase(1,{account:1000});await f.purchase(2,{account:1001});await f.purchase(3,{owner:3});f.batch.finish();
  assert.equal(f.notifications.filter(n=>n.session===a).length,2);assert.equal(f.notifications.filter(n=>n.session===b).length,2);
  assert.equal(f.notifications.filter(n=>n.session===other).length,1);
  assert.deepEqual(new Set(f.notifications.filter(n=>n.session===a).map(n=>n.args[2][0])),new Set(['cash','cash2']));
  assert.equal(f.read('EN').length,1);assert.equal(f.read('EN',2,1001).length,1);assert.equal(f.read('EN',3).length,1);
  assert.equal(f.read('EN')[0].amount,92);assert.equal(f.read('EN',2,1001)[0].amount,92);assert.equal(f.read('EN',3)[0].amount,92);
});
test('closed or changed sessions do not receive a deferred popup; newest balance is used',async t=>{
  const f=fixture(t),closed=f.session(),changed=f.session(),valid=f.session();await f.purchase(1);
  closed.socket.destroyed=true;changed.characterID=3;
  // Simulate a current committed projection newer than a retried receipt.
  await f.purchase(2);f.batch.finish();assert.equal(f.notifications.length,1);assert.equal(f.notifications[0].session,valid);
  assert.equal(f.notifications[0].args[2][2],1184);
});
test('failed and fingerprint-collided native commands do not add a journal mapping',async t=>{
  const f=fixture(t);f.batch.tagOperation('npc-market:failure',true);
  await f.batch.command('npc-market:failure:wallet:seller-credit',2,false,1000,async()=>({success:false}));
  await f.batch.command('npc-market:failure:wallet:tax-debit',2,false,1000,async()=>({success:true,fingerprintMismatch:true,journalEntry:{transactionID:1}}));
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM nm_wallet_batch_entries').get().n,0);
});
test('native commit before a lost reply is recovered into the same summary once',async t=>{
  const f=fixture(t);f.session();await f.purchase(1);
  const key='npc-market:900000:2:2:60003760';f.loseNextReply(key+':wallet:tax-debit');
  await assert.rejects(f.purchase(2),/lost native reply/);f.reopen();
  await f.purchase(2);f.batch.finish();assert.equal(f.balance,1184);assert.equal(f.rows.length,4);
  assert.equal(f.read('EN').length,1);assert.equal(f.read('EN')[0].amount,184);
  assert.match(f.read('EN')[0].description,/2 purchases.*200.00 ISK; tax 16.00/);
});
test('summary includes the full batch when native journal trims to its 1000-row limit',async t=>{
  const f=fixture(t);f.session();for(let i=0;i<650;i++)await f.purchase(i);
  f.batch.finish();assert.equal(f.rows.length,1000);const result=f.read('EN');assert.equal(result.length,1);
  assert.equal(result[0].amount,59800);assert.equal(result[0].balance,60800);assert.match(result[0].description,/650 purchases/);
});
test('all eight client languages have summaries; Account methods retain native permissions',async t=>{
  const f=fixture(t);await f.purchase(1);f.batch.finish();
  for(const language of ['EN','DE','ES','FR','JA','KO','RU','ZH']){
    assert.ok(summaries[language]);const rows=f.read(language);assert.equal(rows.length,1);assert.ok(!rows[0].description.includes('{gross}'));
    if(language!=='EN')assert.notEqual(rows[0].description,f.read('EN')[0].description);
  }
  const source=fs.readFileSync(path.join(root,'server/src/services/account/accountService.js'),'utf8');
  const methods=source.slice(source.indexOf('  Handle_GetJournal('),source.indexOf('  async Handle_GiveCash('));
  const ctx={...f.native,normalizeNumber:(value,fallback)=>value==null?fallback:Number.isNaN(Number(value))?fallback:Number(value),
    extractKwarg:(kwargs,key)=>kwargs?.[key],resolveAccountKey:value=>({id:Number(value)||1000}),normalizeCorporationWalletKey:value=>Number(value)||1000,
    requireCorporationWalletDivisionRead:session=>{if(!session.allowed)throw Error('native permission denied');},
    buildJournalRowset:rows=>rows,buildTransactionList:rows=>rows};
  vm.createContext(ctx);vm.runInContext(`class Account {${methods}};this.Account=Account`,ctx);
  f.batch.installAccountService(ctx.Account);const account=new ctx.Account();
  assert.throws(()=>account.Handle_GetTransactions([1000,2026,10,true],{corporationID:2}),/permission denied/);
  const response=account.Handle_GetTransactions([1000,2026,10,false],{characterID:2,languageID:'DE'});
  assert.equal(response.length,1);assert.match(response[0].description,/Offlinezeit/);
  assert.equal(account.Handle_GetJournal([],{characterID:2}).length,1);
  await f.purchase(2,{offline:false});
  const online=account.Handle_GetTransactions([1000,2026,10,false],{characterID:2,languageID:'DE'});
  assert.equal(online.length,3);assert.match(online[1].description,/Verkauf an NPC/);
});
test('engine catches up 500 groups responsively, one popup and 500 separate Activity sales',async t=>{
  const f=fixture(t);f.session();let now=0,heartbeats=0;
  const config={...DEFAULTS,enabled:true,offlinePurchases:true,ironMode:true,randomBatch:false};
  const orders=Array.from({length:500},(_,i)=>({orderID:String(i),sellerID:2,ownerID:2,typeID:1000+i,stationID:60003760,price:100,quantity:1,source:'player'}));
  const adapter={recover:async()=>{},listOrders:async()=>orders.filter(order=>order.quantity>0),buy:async(order,quantity,key)=>{
    await f.adjust(100,key+':wallet:seller-credit');await f.adjust(-8,key+':wallet:tax-debit');
    orders[Number(order.orderID)].quantity=0;
    return {state:'settled',quantity,grossISK:100,taxISK:8};}};
  const engine=createEngine({adapter,quotes:{get:async()=>({referencePrice:100,updatedAt:now,confidence:'high',dailyVolume:1})},
    store:f.store,getConfig:()=>config,evaluate,clock:()=>now,random:()=>0,walletBatching:f.batch,log:{error(){}}});
  await engine.runCycle();now=1800000;
  const timer=setInterval(()=>heartbeats++,2),started=performance.now();
  try{await engine.runCycle();}finally{clearInterval(timer);}
  assert.ok(heartbeats>=100,'event loop must receive turns during the backlog');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM nm_operations WHERE state='settled'").get().n,500);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM nm_activity WHERE kind='purchase'").get().n,500);
  assert.equal(f.notifications.length,0,'keep the batch open across overdue scheduler passes');
  await engine.runCycle(); // sold-out market skips the remaining empty backlog
  assert.equal(f.notifications.length,1);assert.equal(f.read('EN').length,1);assert.equal(f.read('EN')[0].amount,46000);
  t.diagnostic(JSON.stringify({sales:500,nativeWalletLegs:1000,popups:f.notifications.length,eventLoopTurns:heartbeats,elapsedMS:Math.round(performance.now()-started)}));
  await engine.stop();
});
test('one notification spans multiple missed cycles and the final current-time check',async t=>{
  const f=fixture(t);f.session();let now=0;
  const config={...DEFAULTS,enabled:true,offlinePurchases:true,randomBatch:false};
  const order={orderID:'1',sellerID:2,ownerID:2,typeID:34,stationID:60003760,price:100,quantity:1,source:'player'};
  const adapter={recover:async()=>{},listOrders:async()=>[order],buy:async(o,q,key)=>{
    await f.adjust(100,key+':wallet:seller-credit');await f.adjust(-8,key+':wallet:tax-debit');
    return {state:'settled',quantity:q,grossISK:100};}};
  const engine=createEngine({adapter,quotes:{get:async()=>({referencePrice:100,updatedAt:now,confidence:'high'})},
    store:f.store,getConfig:()=>config,evaluate,clock:()=>now,random:()=>0,walletBatching:f.batch,yieldControl:()=>Promise.resolve()});
  await engine.runCycle();now=3600000;
  for(let cycle=0;cycle<3;cycle++){await engine.runCycle();assert.equal(f.notifications.length,0);}
  await engine.runCycle();assert.equal(f.notifications.length,1);assert.equal(f.balance,1368);
  assert.equal(f.read('EN').length,1);assert.equal(f.read('EN')[0].amount,368);
  assert.match(f.read('EN')[0].description,/4 purchases/);await engine.stop();
});
