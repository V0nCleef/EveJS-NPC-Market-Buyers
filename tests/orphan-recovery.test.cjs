'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,clone}=require('./helpers/orphanFixture.cjs');
function complete(f){
  assert.equal(f.state.owners[2].balance,900);assert.equal(f.state.owners[3].balance,100);
  assert.equal(f.state.items[11].ownerID,2);assert.equal(f.state.items[11].locationID,60003760);assert.equal(f.totalItems(),100);
  assert.deepEqual(f.state.effects,{goods:1,wallet:3});
  assert.equal(f.store.db.prepare('SELECT state FROM nm_operations WHERE operation_key=?').get(f.key).state,'rejected');
  assert.equal(f.store.db.prepare('SELECT state FROM nm_native_ops WHERE operation_key=?').get(f.key).state,'rejected');
  assert.equal(f.store.db.prepare('SELECT state FROM nm_orphan_recovery WHERE operation_key=?').get(f.key).state,'compensated');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM nm_sales').get().n,0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM nm_native_outbox').get().n,0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM nm_activity WHERE kind='purchase'").get().n,0);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM nm_activity WHERE kind='recovery_compensated'").get().n,1);
  assert.equal(f.store.db.prepare('SELECT amount_cents FROM nm_funding').get().amount_cents,10000);
}
test('proven terminal zero fill uses normal recovery to compensate money/goods once and retains funding',async t=>{
  const f=fixture(t),market=clone(f.market);await f.engine().runCycle();complete(f);
  await f.engine().runCycle();await f.bridge.recover();complete(f);assert.deepEqual(f.market,market);
});
test('lost replies after each durable owner effect replay the same receipts after mod reopen',async t=>{
  for(const name of ['goods-return','tax-refund','seller-reversal','buyer-refund']){
    const f=fixture(t);f.failAfter(name);await assert.rejects(f.engine().runCycle(),/lost reply/);f.reopen();
    await f.engine().runCycle();complete(f);await f.engine().runCycle();complete(f);
  }
});
test('an issued missing wallet receipt at capacity blocks without sending another command',async t=>{
  const f=fixture(t);f.failBefore('tax-refund');await assert.rejects(f.engine().runCycle(),/before send/);
  const before=clone(f.state.effects);f.reopen();const calls=f.state.calls.wallet;
  await assert.rejects(f.engine().runCycle(),/may have been evicted/);assert.deepEqual(f.state.effects,before);assert.equal(f.state.calls.wallet,calls);
});
test('an uncommitted issued phase with unsaturated owner ledgers retries its exact immutable key',async t=>{
  const f=fixture(t,{saturated:false});f.failBefore('tax-refund');await assert.rejects(f.engine().runCycle(),/before send/);f.reopen();await f.engine().runCycle();complete(f);
});
test('positive legacy compensation receipt is honored when its authority acknowledgement is missing',async t=>{
  const f=fixture(t);f.failAfter('tax-refund');await assert.rejects(f.engine().runCycle(),/lost reply/);
  const key=f.key+':orphan-zero-fill-v1:wallet:tax-refund';
  f.state.owners[2].walletAuthorityReceipts=f.state.owners[2].walletAuthorityReceipts.filter(row=>row.commandID!==key);f.persist();f.reopen();
  await f.engine().runCycle();complete(f);
});
test('contradictory/absent original proofs or unsupported cases cannot start compensation',async t=>{
  const controls=[
    f=>{const r=JSON.parse(f.market.fillReceipt.response_json);r.filled_quantity=10;f.market.fillReceipt.response_json=JSON.stringify(r);},
    f=>{f.state.owners[2].walletOperationReceipts=f.state.owners[2].walletOperationReceipts.filter(r=>r.idempotencyKey!==f.key+':wallet:tax-debit');},
    f=>{f.state.owners[2].walletOperationReceipts.push(clone(f.state.owners[2].walletOperationReceipts.find(r=>r.idempotencyKey===f.key+':wallet:seller-credit')));},
    f=>{f.state.owners[2].walletAuthorityReceipts.push(clone(f.state.owners[2].walletAuthorityReceipts.find(r=>r.commandID===f.key+':wallet:seller-credit')));},
    f=>{f.state.custody[f.key+':inventory:0'].fingerprint.actor=2;},
    f=>{f.state.custody[f.key+':inventory:0'].receiptKey='wrong-address';},
    f=>{Object.values(f.state.custody).find(r=>r.fingerprint.reason==='market-escrow-return').fingerprint.actor=99;},
    f=>{f.state.items[11].ownerID=99;},
    f=>{f.state.items[11].quantity=f.state.items[11].stacksize=9;},
    f=>{f.api.qualified=false;},
    f=>{const n=f.store.db.prepare('SELECT saga_json FROM nm_native_ops').get();const s=JSON.parse(n.saga_json);s.sellerIsCorp=true;f.store.db.prepare('UPDATE nm_native_ops SET saga_json=?').run(JSON.stringify(s));},
    f=>{f.store.db.prepare('UPDATE nm_operations SET cost_cents=?').run(Number.MAX_SAFE_INTEGER+10);},
    f=>{f.store.db.prepare('UPDATE nm_funding SET amount_cents=?').run(Number.MAX_SAFE_INTEGER+10);},
    f=>{f.state.owners[3].balance=2000000000;},
    f=>{f.state.owners[2].balance=0;},
    f=>{f.state.owners[2].walletOperationReceipts.find(r=>r.idempotencyKey===f.key+':wallet:tax-debit').result.journalEntry.transactionDate='134379000000000000';},
  ];
  for(const mutate of controls){const f=fixture(t);mutate(f);await assert.rejects(f.engine().runCycle());assert.deepEqual(f.state.effects,{goods:0,wallet:0});}
});
test('a reopened/changed terminal owner order on retry is rejected before another owner effect',async t=>{
  for(const change of [f=>{f.market.currentOrder.state='open';},f=>{f.market.currentOrder.owner_id=9;},
    f=>{f.market.currentOrder.row.type_id=35;},f=>{f.market.currentOrder.row.price=11;},f=>{f.market.currentOrder.row.vol_remaining=99;},
    f=>{f.market.currentOrder.row.station_id=60000001;},f=>{f.market.currentOrder.source='seed';}]){
    const f=fixture(t);f.failAfter('goods-return');await assert.rejects(f.engine().runCycle(),/lost reply/);change(f);
    const before=clone(f.state.effects);f.reopen();await assert.rejects(f.engine().runCycle());assert.deepEqual(f.state.effects,before);
  }
});
test('journal CAS refusal is detected before any owner command',async t=>{
  const f=fixture(t),prepare=f.store.db.prepare.bind(f.store.db);
  f.store.db.prepare=sql=>sql.startsWith('UPDATE nm_orphan_recovery SET')?{run:()=>({changes:0})}:prepare(sql);
  await assert.rejects(f.engine().runCycle(),/compare-and-swap failed/);assert.deepEqual(f.state.effects,{goods:0,wallet:0});
});
test('native exact-credit refusal after a capacity race never clips or completes the compensation',async t=>{
  const f=fixture(t),issue=f.api.issueWallet;
  f.api.issueWallet=async(leg,metadata)=>{if(leg.name==='tax-refund')f.state.owners[2].balance=2000000000;return issue(leg,metadata);};
  await assert.rejects(f.engine().runCycle(),/refused, clipped or mismatched/);
  assert.deepEqual(f.state.effects,{goods:1,wallet:0});assert.equal(f.state.owners[2].balance,2000000000);
  assert.equal(f.store.db.prepare('SELECT state FROM nm_orphan_recovery').get().state,'pending');
});
test('invalid progress is validated before goods and column-name binding supports reordered journal tables',async t=>{
  const f=fixture(t);f.store.db.exec(`CREATE TABLE nm_orphan_recovery(state TEXT,updated_at INTEGER,progress_json TEXT,plan_sha TEXT,
    plan_json TEXT,schema INTEGER,operation_key TEXT PRIMARY KEY)`);await f.engine().runCycle();complete(f);
  const g=fixture(t);g.failBefore('goods-return');await assert.rejects(g.engine().runCycle(),/before send/);
  g.store.db.prepare("UPDATE nm_orphan_recovery SET progress_json=?").run(JSON.stringify({custody:{state:'new'},wallets:[]}));
  const before=clone(g.state.effects);g.reopen();await assert.rejects(g.engine().runCycle(),/progress shape/);assert.deepEqual(g.state.effects,before);
});
