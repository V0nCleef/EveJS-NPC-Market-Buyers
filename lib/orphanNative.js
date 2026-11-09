'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {check,cents,same,blocked}=require('./orphanEvidence');
const hostIdentities=require('./orphanHostIdentities.json');
const sha=text=>crypto.createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');
function createOrphanNative({root,database,marketDaemonClient,wallet,walletReceipts,itemCustody,marketSourceSHA,walletMaxBalance}){
  root=fs.realpathSync(root);
  const walletSourceSHA=sha(fs.readFileSync(path.join(root,'server/src/services/account/walletState.js'),'utf8'));
  const qualified=hostIdentities.qualified.find(row=>row.marketSource===marketSourceSHA&&row.walletSource===walletSourceSHA);
  function read(table,key,{optional=false}={}){
    const result=database.readPersisted(table,'/'+key);
    if(result?.success===true)return result.data;
    if(optional&&result?.errorMsg==='ENTRY_NOT_FOUND')return null;
    blocked('durable '+table+' owner read failed: '+String(result?.errorMsg||'unavailable'));
  }
  const custodyKey=key=>'item-custody:local:'+crypto.createHash('sha256').update(key).digest('hex');
  const readCustody=key=>read('items','__evejsInventoryGrantReceipts/'+encodeURIComponent(custodyKey(key)),{optional:true});
  const readWallet=ownerID=>read('walletAuthorityState','character:'+ownerID);
  const readItem=itemID=>read('items',String(itemID),{optional:true});
  async function readMarket(key,order){
    const health=await marketDaemonClient.call('Health',{}),status=marketDaemonClient.getStatus();
    check(health?.status==='ok'&&health.capabilities?.includes('conditional-fill-v1'),'native market capability is not available');
    check(['127.0.0.1','::1','localhost'].includes(String(status.host).toLowerCase()),'market authority is not local loopback');
    const remote=marketDaemonClient._socket?.remoteAddress;
    if(remote)check(['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote),'market socket is not loopback');
    check(typeof health.database_path==='string'&&health.database_path.length>0&&health.database_path.length<4096,'market owner did not advertise its database');
    const nativeRoot=fs.realpathSync(path.join(root,'externalservices/market-server'));
    // The normal Native Launcher owns this cwd. An absolute owner-advertised
    // path may also be under the explicitly configured game data root used by
    // isolated profiles. There is no fallback to a default market.sqlite.
    const candidate=path.isAbsolute(health.database_path)?health.database_path:path.resolve(nativeRoot,health.database_path);
    const file=fs.realpathSync(candidate),allowed=[root];
    if(process.env.EVEJS_DATA_ROOT)allowed.push(fs.realpathSync(process.env.EVEJS_DATA_ROOT));
    check(allowed.some(base=>file.toLowerCase().startsWith((base+path.sep).toLowerCase()))&&fs.statSync(file).isFile(),'market owner database is outside the selected physical runtime/data roots');
    const Database=require(path.join(root,'server/node_modules/better-sqlite3'));
    const db=new Database(file,{readonly:true,fileMustExist:true});let local,fill;
    try{
      db.pragma('query_only=ON');db.pragma('busy_timeout=5000');
      const columns=db.prepare('PRAGMA table_info(market_fill_receipts)').all().map(row=>row.name).sort();
      check(same(columns,['idempotency_key','order_id','fill_quantity','response_json','created_at'].sort()),'unknown daemon receipt schema');
      local=db.prepare('SELECT * FROM market_orders WHERE order_id=?').get(order.orderID);
      fill=db.prepare('SELECT * FROM market_fill_receipts WHERE idempotency_key=?').get(key+':daemon-fill');
    }finally{db.close();}
    const rpc=await marketDaemonClient.call('GetOrder',{order_id:String(order.orderID)}),row=rpc?.row||rpc;
    check(local&&rpc&&String(local.order_id)===String(rpc.order_id||row.order_id)&&
      Number(local.owner_id)===Number(rpc.owner_id)&&Boolean(local.is_corp)===Boolean(rpc.is_corp)&&
      local.state===rpc.state&&local.source===(rpc.source||row.source)&&Number(local.type_id)===Number(row.type_id)&&
      Number(local.station_id)===Number(row.station_id)&&cents(local.price)===cents(row.price)&&
      Number(local.vol_remaining)===Number(row.vol_remaining),'advertised physical market database and live owner order disagree');
    return {fillReceipt:fill,currentOrder:rpc,database:file};
  }
  async function evidence({key,operation,nativeOperation,funding,buyerID,sale,outbox,anchor}){
    const order=JSON.parse(operation.order_json),saga=JSON.parse(nativeOperation.saga_json);
    const market=await readMarket(key,order),leg=saga.itemLegs?.[0],source=leg?.sourceItem;
    check(source&&Number.isSafeInteger(Number(order.orderID)),'original custody source is unavailable');
    const escrowLocation=9200000000+Number(order.orderID);
    const terminalReturnKey=`market:market-escrow-return:${order.orderID}:${source.itemID}:available:${order.quantity-operation.quantity}:move:whole:`+
      `${source.ownerID}:${escrowLocation}:4:${source.ownerID}:${order.stationID}:4`;
    const forwardReceipt=readCustody(key+':inventory:0'),items={};
    for(const change of forwardReceipt?.resultData?.changes||[])if(Number.isSafeInteger(change.item?.itemID))items[change.item.itemID]=readItem(change.item.itemID);
    return {key,operation,nativeOperation,funding,buyerID,sale,outbox,anchor,escrowLocation,terminalReturnKey,
      ...market,hostQualified:Boolean(qualified),walletMaxBalance,wallets:{[order.sellerID]:readWallet(order.sellerID),[saga.buyerCharacterID]:readWallet(saga.buyerCharacterID)},
      buyerIdentity:read('characters',String(saga.buyerCharacterID)),forwardReceipt,terminalReceipt:readCustody(terminalReturnKey),
      oldInventoryCompensation:readCustody(key+':inventory-compensate:0'),items};
  }
  function expectedAuthority(leg){return walletReceipts.fingerprint('character.adjust-isk',{charId:leg.ownerID,amount:leg.amountCents/100,options:leg.options});}
  async function issueWallet(leg,metadata){return wallet.adjustCharacterBalanceAsync(leg.ownerID,leg.amountCents/100,leg.options,metadata);}
  function issueCustody(leg){
    return itemCustody.transfer({items:{itemID:leg.itemID,quantity:leg.quantity},from:leg.source,to:leg.destination,
      reason:itemCustody.CUSTODY_REASON.MARKET_FILL_COMPENSATE,actor:leg.actor,idempotencyKey:leg.key});
  }
  return {qualified:Boolean(qualified),evidence,readMarket,readWallet,readItem,readCustody,expectedAuthority,issueWallet,issueCustody,
    authorityReceiptLimit:qualified?.authorityReceiptLimit||1024,legacyReceiptLimit:qualified?.legacyReceiptLimit||512};
}
module.exports={createOrphanNative};
