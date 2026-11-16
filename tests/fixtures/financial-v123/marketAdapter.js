"use strict";
const path=require('node:path');
const crypto=require('node:crypto');

function once(source, needle, replacement, label) {
  if(source.split(needle).length!==2) throw Error(`NPC Market Buyers: incompatible market source at ${label}`);
  return source.replace(needle,replacement);
}
function prepareMarketSource(source) {
  source=String(source).replace(/\r\n/g,'\n');
  const marketSourceSHA=crypto.createHash('sha256').update(source).digest('hex');
  if(source.includes('__npcMarketBuyerBridge')) throw Error('NPC Market Buyers: market bridge already installed');
  const start=source.indexOf('async function executePlayerSellFillSagaUnlocked(');
  const end=source.indexOf('async function executePlayerSellFillSaga(',start+1);
  if(start<0||end<0) throw Error('NPC Market Buyers: player sell saga seam missing');
  let part=source.slice(start,end);
  part=once(part,'idempotency_key: `${saga.operationKey}:daemon-fill`,',
    'idempotency_key: `${saga.operationKey}:daemon-fill`,\n      expected: saga.npcMarketExpected || undefined,','conditional fill');
  part=once(part,'    saga.fillResponse = fillResponse;',`    if (saga.npcMarketExpected && (fillResponse.filled_quantity !== saga.tradedQuantity ||
        Number(fillResponse.price) !== saga.orderPrice)) {
      const rejected = new Error("NPC conditional fill returned a mismatching fill");
      rejected.code = "MARKET_DAEMON_RPC_REJECTED";
      rejected.marketDaemonOutcomeUnknown = false;
      throw rejected;
    }
    saga.fillResponse = fillResponse;`,'zero fill rejection');
  // Record our receipt before the server clears its pending-fill anchor.
  // This completion point exists in stock EveJS and local trade-history builds.
  part=once(part,'    if (fillResponse.state === "filled") {',
    '    if (saga.npcMarketExpected) await __npcMarketBuyerBridge.completed(saga, fillResponse);\n\n    if (fillResponse.state === "filled") {','durable completion');
  part=once(part,'    if (canCompensateRejectedPrimaryFill(saga, error)) {',
    '    if (!(saga.npcMarketExpected && __npcMarketBuyerBridge.hasUnacknowledgedWallet(saga.operationKey)) && canCompensateRejectedPrimaryFill(saga, error)) {','ambiguous wallet outcome');
  source=source.slice(0,start)+part+source.slice(end);
  const terminalStart=source.indexOf('async function applyTerminalOrderEvent('),terminalEnd=source.indexOf('async function applyExpiredOrderEvent(',terminalStart);
  if(terminalStart<0||terminalEnd<0)throw Error('NPC Market Buyers: terminal expiry seam missing');
  let terminal=source.slice(terminalStart,terminalEnd);
  terminal=once(terminal,'  const escrowRecord = getEscrowRecord(orderID);',`  const escrowRecord = getEscrowRecord(orderID);
  if (escrowRecord && escrowRecord.pendingFill &&
      String(escrowRecord.pendingFill.operationKey || '').startsWith('npc-market:')) {
    const deferred = new Error('NPC purchase recovery must finish before terminal escrow return');
    deferred.code = 'NPC_TERMINAL_DEFERRED';
    throw deferred;
  }`,'pending terminal escrow fence');
  source=source.slice(0,terminalStart)+terminal+source.slice(terminalEnd);
  const pollStart=source.indexOf('async function processPendingExpiryEvents(');
  const boundaries=[source.indexOf('\nfunction ',pollStart+1),source.indexOf('\nasync function ',pollStart+1)].filter(value=>value>=0);
  if(pollStart<0||!boundaries.length)throw Error('NPC Market Buyers: terminal poll seam missing');
  const pollEnd=Math.min(...boundaries);let poll=source.slice(pollStart,pollEnd);
  poll=once(poll,'        await applyTerminalOrderEvent(event);',`        try {
          await applyTerminalOrderEvent(event);
        } catch (error) {
          if (error && error.code === 'NPC_TERMINAL_DEFERRED') {
            // Leave this durable event unacknowledged. Exit this bounded poll
            // cleanly so startup succeeds and the next poll/cold boot retries.
            return { npcMarketDeferred: true, eventID: String(event.event_id || '') };
          }
          throw error;
        }`,'unacknowledged terminal event retry');
  source=source.slice(0,pollStart)+poll+source.slice(pollEnd);
  // Only NPC-namespaced legs get transport command IDs. Normal trades retain
  // their existing behavior; corporation commands now have durable retries.
  for(const [begin,finish] of [['async function debitCharacterWallet(','async function creditCharacterWallet('],
    ['async function creditCharacterWallet(','async function applySignedCharacterWalletDelta(']]) {
    const a=source.indexOf(begin),b=source.indexOf(finish,a+1);
    if(a<0||b<0) throw Error('NPC Market Buyers: wallet seam missing');
    let wallet=source.slice(a,b);
    wallet=once(wallet,'    idempotencyKey: options.idempotencyKey,\n  });',
      '    idempotencyKey: options.idempotencyKey,\n  }, __npcMarketBuyerBridge.walletMetadata(options, characterID, false));','personal command ID');
    wallet=once(wallet,'        entryTypeID: options.entryTypeID ?? JOURNAL_ENTRY_TYPE.ADMIN_ADJUSTMENT,\n      },\n    );',
      '        entryTypeID: options.entryTypeID ?? JOURNAL_ENTRY_TYPE.ADMIN_ADJUSTMENT,\n      },\n      __npcMarketBuyerBridge.walletMetadata(options, characterID, true),\n    );','corporation command ID');
    if(wallet.split('if (!result.success) {').length!==3)throw Error('NPC Market Buyers: wallet result seam changed');
    wallet=wallet.replaceAll('if (!result.success) {','__npcMarketBuyerBridge.walletAcknowledged(options, result);\n    if (!result.success) {');
    if(begin.includes('debit'))wallet=once(wallet,
      '  ensureCharacterHasFunds(characterID, normalizedAmount, description, options);',
      '  if (!__npcMarketBuyerBridge.hasWalletReceipt(options, characterID, options.isCorp === true))\n    ensureCharacterHasFunds(characterID, normalizedAmount, description, options);','wallet replay funds check');
    source=source.slice(0,a)+wallet+source.slice(b);
  }
  const attachment=`
const __npcMarketBuyerBridge = require(${JSON.stringify(path.join(__dirname,'settlement.js'))}).createNativeBridge({
  database, marketDaemonClient, listEscrowRecords, getEscrowRecord, fetchOrderById,
  getOwnerOrderResponseOrder, buildPlayerSellFillSaga, persistPlayerSellFillSaga,
  executePlayerSellFillSaga, buildCharacterMarketContext, computeSalesTaxAmount,
  getMarketCounterpartyOwnerID, notifyOwnOrdersChanged,
  wallet: require(path.join(__dirname, '../account/walletState')),
  corpWallet: require(path.join(__dirname, '../corporation/corpWalletState')),
  authority: require(path.join(__dirname, '../account/walletCommandAuthority')),
  walletReceipts: require(path.join(__dirname, '../account/walletAuthorityReceiptState')),
  orphan: require(${JSON.stringify(path.join(__dirname,'orphanNative.js'))}).createOrphanNative({
    root: path.resolve(__dirname, '../../../..'), database, marketDaemonClient,
    wallet: require(path.join(__dirname, '../account/walletState')),
    walletReceipts: require(path.join(__dirname, '../account/walletAuthorityReceiptState')),
    itemCustody, marketSourceSHA: ${JSON.stringify(marketSourceSHA)},
    walletMaxBalance: require(path.join(__dirname, '../account/walletBalanceLimit')).MAX_WALLET_BALANCE
  }),
  characters: require(path.join(__dirname, '../character/characterState')),
  allocator: require(path.join(__dirname, '../_shared/identityAllocator')),
  getStationRecord, getStationSolarSystemID, getStationConstellationID
});
// All Node market mutations, including expiry and recovery, share one
// reentrant gate. The daemon guard additionally fences external mutations.
for (const name of ['Handle_PlaceBuyOrder','Handle_BuyMultipleItems','Handle_PlaceMultiSellOrder',
  'Handle_PlacePlexSellOrder','Handle_ModifyCharOrder','Handle_CancelCharOrder']) {
  if (typeof MarketProxyService.prototype[name] === 'function')
    MarketProxyService.prototype[name] = __npcMarketBuyerBridge.wrap(MarketProxyService.prototype[name]);
}
processPendingExpiryEvents = __npcMarketBuyerBridge.wrap(processPendingExpiryEvents);
handleDurableMarketOrderExpiry = __npcMarketBuyerBridge.wrap(handleDurableMarketOrderExpiry);
handleDurableMarketFillRecovery = __npcMarketBuyerBridge.wrap(handleDurableMarketFillRecovery);
reconcileDurableMarketOrders = __npcMarketBuyerBridge.wrap(reconcileDurableMarketOrders);
module.exports.__npcMarketBuyerBridge = __npcMarketBuyerBridge;
module.exports.__npcMarketLocalQuote = require(${JSON.stringify(path.join(__dirname,'localQuote.js'))}).createLocalQuoteProvider({
  marketDaemonClient, getStationRecord, getStationSolarSystemID, isBidOrderInRange,
  hasPendingMarketFillSagaForOrder
});
`;
  // Export before the original export assignments, otherwise those assignments
  // overwrite the bridge. Functions execute only after module initialization.
  return once(source,'module.exports = MarketProxyService;',
    'module.exports = MarketProxyService;\n'+attachment,'public export');
}
function createMarketAdapter(root,{store}={}) {
  const service=require(path.join(root,'server/src/services/market/marketProxyService.js'));
  const bridge=service.__npcMarketBuyerBridge;
  if(!bridge) throw Error('NPC Market Buyers: guarded market bridge not installed');
  bridge.attach(store);
  return {listOrders:()=>bridge.listOrders(),localQuote:service.__npcMarketLocalQuote,buy:(order,quantity,key)=>bridge.buy(order,quantity,key),
    recover:()=>bridge.recover(),ready:()=>bridge.ready(),status:()=>bridge.status(),close:()=>bridge.close()};
}
module.exports={prepareMarketSource,createMarketAdapter};
