/* Inventory invariants that are easiest to prove directly against SQLite.
   HTTP behaviour (accounts, validation and status controls) is covered by
   behaviour.mjs; this file exercises the atomic database boundary itself. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import * as db from '../../server/db.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ky-inventory-test-'));
const file = path.join(dir, 'inventory.db');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PORT = 8981;
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const line = (slug, qty, title = slug) => ({
  slug, title, unit: '', price: 1000, qty, sum: 1000 * qty,
});

const order = (over = {}) => ({
  id: crypto.randomUUID(),
  code: `KY-TEST-${crypto.randomBytes(3).toString('hex')}`,
  token: crypto.randomBytes(16).toString('hex'),
  customer: { name: 'Test' },
  subtotal: 3000,
  shipping: 0,
  total: 3000,
  currency: 'IRR',
  status: 'pending_payment',
  provider: 'offline',
  payAuthority: null,
  payRef: null,
  adminNote: '',
  at: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
  paidAt: null,
  autoCancelled: false,
  items: [{ slug: 'limited', title: 'Limited', unit: '', price: 1000, qty: 3, sum: 3000 }],
  ...over,
});

let D;
let server;
try {
  D = await db.openDB(file);
  db.replaceProducts(D, [
    { slug: 'limited', title: 'Limited', price: 1000, stock: 5, active: true },
    { slug: 'late', title: 'Late callback', price: 1000, stock: 5, active: true },
    { slug: 'late-empty', title: 'Late callback without stock', price: 1000, stock: 3, active: true },
    { slug: 'nested-a', title: 'Nested transaction A', price: 1000, stock: 5, active: true },
    { slug: 'nested-b', title: 'Nested transaction B', price: 1000, stock: 5, active: true },
    { slug: 'protected-stock', title: 'Protected payment stock', price: 1000, stock: 5, active: true },
    { slug: 'unlimited', title: 'Unlimited', price: 1000, stock: -1, active: true },
  ]);

  /* Authority and ref_id have different jobs and columns. Updating the receipt
     reference must preserve the authority, and the unique index must reject a
     second order that tries to claim the same gateway payment. */
  const authorityOwner = order({
    id: crypto.randomUUID(),
    code: `KY-AUTH-${Date.now()}`,
    status: 'paid',
    provider: 'zarinpal',
    payAuthority: 'A-ONE-PAYMENT-ONE-ORDER',
    payRef: 'REF-ORIGINAL',
    paidAt: new Date().toISOString(),
    items: [],
  });
  db.insertOrder(D, authorityOwner);
  let storedPayment = db.getOrderById(D, authorityOwner.id);
  check(
    storedPayment.payAuthority === 'A-ONE-PAYMENT-ONE-ORDER' && storedPayment.payRef === 'REF-ORIGINAL',
    'authority and ref_id are persisted separately',
  );
  db.updateOrder(D, authorityOwner.id, { payRef: 'REF-SETTLED' });
  storedPayment = db.getOrderById(D, authorityOwner.id);
  check(
    storedPayment.payAuthority === 'A-ONE-PAYMENT-ONE-ORDER' && storedPayment.payRef === 'REF-SETTLED',
    'settlement reference cannot overwrite the payment authority',
  );
  /* Simulate an existing pre-ledger database: reopening must backfill its
     current authority without changing the separate settlement reference. */
  D.prepare('DELETE FROM order_payments WHERE authority = ?').run('A-ONE-PAYMENT-ONE-ORDER');
  D.close();
  D = await db.openDB(file);
  check(
    db.getOrderPaymentAttempt(D, authorityOwner.id, 'A-ONE-PAYMENT-ONE-ORDER')?.refId === 'REF-SETTLED',
    'migration backfills existing order authorities into the attempt ledger',
  );
  let duplicateAuthorityRejected = false;
  try {
    db.insertOrder(D, order({
      id: crypto.randomUUID(),
      code: `KY-AUTH-COPY-${Date.now()}`,
      provider: 'zarinpal',
      payAuthority: 'A-ONE-PAYMENT-ONE-ORDER',
      items: [],
    }));
  } catch {
    duplicateAuthorityRejected = true;
  }
  check(duplicateAuthorityRejected, 'the database unique index rejects one authority on two orders');
  const settledDelete = db.deleteOrder(D, authorityOwner.id, { restoreInventory: true });
  check(
    !settledDelete.ok && settledDelete.error === 'payment history protected' &&
      db.getOrderById(D, authorityOwner.id)?.payRef === 'REF-SETTLED' &&
      db.getOrderPaymentAttempt(D, authorityOwner.id, 'A-ONE-PAYMENT-ONE-ORDER')?.status === 'settled',
    'settled orders cannot be deleted with their authority and ref_id evidence',
  );

  const pendingAuthority = order({
    id: crypto.randomUUID(),
    code: `KY-AUTH-PENDING-${Date.now()}`,
    provider: 'zarinpal',
    payAuthority: 'A-PENDING-OWNER',
    items: [],
  });
  db.insertOrder(D, pendingAuthority);
  const retryAuthority = 'A-PENDING-RETRY';
  const retryRecorded = db.recordOrderPaymentAttempt(D, pendingAuthority.id, {
    authority: retryAuthority,
    provider: 'zarinpal',
  });
  const preservedAttempts = db.listOrderPaymentAttempts(D, pendingAuthority.id);
  check(
    retryRecorded.current && db.getOrderById(D, pendingAuthority.id).payAuthority === retryAuthority,
    'a retry becomes the current payment pointer while the order is pending',
  );
  check(
    preservedAttempts.map((attempt) => attempt.authority).join(',') === `A-PENDING-OWNER,${retryAuthority}`,
    'a retry preserves every previously issued authority in its order ledger',
  );
  check(
    db.getOrderByPaymentAuthority(D, 'A-PENDING-OWNER')?.id === pendingAuthority.id,
    'an earlier authority still maps back to its exact order after retry',
  );
  const issuedDelete = db.deleteOrder(D, pendingAuthority.id);
  check(
    !issuedDelete.ok && issuedDelete.error === 'payment history protected' &&
      db.getOrderById(D, pendingAuthority.id)?.status === 'pending_payment' &&
      db.listOrderPaymentAttempts(D, pendingAuthority.id).length === 2,
    'an issued payment link also protects its order because it may be paid later',
  );
  db.updateOrder(D, pendingAuthority.id, { archived: true });
  check(
    db.getOrderById(D, pendingAuthority.id)?.archived &&
      db.listOrderPaymentAttempts(D, pendingAuthority.id).length === 2,
    'a protected order can be hidden through reversible archive state without losing payment evidence',
  );
  db.updateOrder(D, pendingAuthority.id, { archived: true, needsAttention: true });
  const visibleAttention = db.getOrderById(D, pendingAuthority.id);
  check(
    visibleAttention?.needsAttention && !visibleAttention.archived,
    'the data layer cannot persist a financial-attention order inside the archive',
  );
  db.updateOrder(D, pendingAuthority.id, { archived: true, needsAttention: false });
  let historicalAuthorityRejected = false;
  try {
    db.insertOrder(D, order({
      id: crypto.randomUUID(),
      code: `KY-HISTORICAL-AUTH-COPY-${Date.now()}`,
      provider: 'zarinpal',
      payAuthority: 'A-PENDING-OWNER',
      items: [],
    }));
  } catch {
    historicalAuthorityRejected = true;
  }
  check(
    historicalAuthorityRejected,
    'the ledger primary key rejects reuse even after an authority is no longer the current pointer',
  );
  check(
    !db.settlePendingOrder(D, pendingAuthority.id, 'A-STOLEN-FROM-ANOTHER-ORDER', {
      provider: 'zarinpal', payRef: 'REF-WRONG', paidAt: new Date().toISOString(), adminNote: '',
    }) && db.getOrderById(D, pendingAuthority.id).status === 'pending_payment',
    'the atomic settlement predicate rejects an authority outside the order ledger',
  );
  check(
    db.settlePendingOrder(D, pendingAuthority.id, 'A-PENDING-OWNER', {
      provider: 'zarinpal', payRef: 'REF-RIGHT', paidAt: new Date().toISOString(), adminNote: '',
    }) &&
      db.getOrderById(D, pendingAuthority.id).payAuthority === 'A-PENDING-OWNER' &&
      db.getOrderById(D, pendingAuthority.id).payRef === 'REF-RIGHT' &&
      !db.getOrderById(D, pendingAuthority.id).archived,
    'an earlier attempt can settle after retry, reappear from archive, and keep authority/ref_id separate',
  );
  check(
    db.getOrderPaymentAttempt(D, pendingAuthority.id, 'A-PENDING-OWNER')?.status === 'settled' &&
      db.getOrderPaymentAttempt(D, pendingAuthority.id, retryAuthority)?.status === 'issued',
    'settlement marks only the authority that actually paid',
  );
  const firstReversalClaim = db.claimOrderPaymentReversal(D, pendingAuthority.id, retryAuthority, {
    refId: 'REF-EXTRA',
  });
  const duplicateReversalClaim = db.claimOrderPaymentReversal(D, pendingAuthority.id, retryAuthority, {
    refId: 'REF-EXTRA',
  });
  check(
    firstReversalClaim.claimed && !duplicateReversalClaim.claimed &&
      duplicateReversalClaim.attempt?.status === 'reversing' &&
      duplicateReversalClaim.attempt?.reversalStartedAt &&
      db.getOrderById(D, pendingAuthority.id).needsAttention,
    'only one worker can claim a fresh reversal and its lease timestamp is durable',
  );
  const reclaimedReversal = db.claimOrderPaymentReversal(D, pendingAuthority.id, retryAuthority, {
    refId: 'REF-EXTRA',
    claimedAt: new Date(Date.now() + 1_000).toISOString(),
    /* Force this test's prior claim beyond the lease boundary without waiting
       fifteen real minutes. Production callers use the conservative default. */
    staleBefore: new Date(Date.now() + 500).toISOString(),
  });
  const duplicateAfterReclaim = db.claimOrderPaymentReversal(D, pendingAuthority.id, retryAuthority, {
    refId: 'REF-EXTRA',
  });
  check(
    reclaimedReversal.claimed && reclaimedReversal.reclaimed && !duplicateAfterReclaim.claimed,
    'an expired reversing claim is atomically reclaimable while the fresh replacement remains exclusive',
  );
  const staleFailure = db.finishOrderPaymentReversal(D, pendingAuthority.id, retryAuthority, {
    claimedAt: firstReversalClaim.attempt.reversalStartedAt,
    ok: false,
    lastError: 'the expired worker returned late',
  });
  check(
    !staleFailure.finished && staleFailure.attempt?.status === 'reversing' &&
      staleFailure.attempt?.reversalStartedAt === reclaimedReversal.attempt?.reversalStartedAt,
    'an expired worker failure is fenced and cannot overwrite the replacement lease',
  );
  const replacementFailure = db.finishOrderPaymentReversal(D, pendingAuthority.id, retryAuthority, {
    claimedAt: reclaimedReversal.attempt.reversalStartedAt,
    ok: false,
    lastError: 'replacement request failed',
  });
  const finalClaim = db.claimOrderPaymentReversal(D, pendingAuthority.id, retryAuthority, {
    refId: 'REF-EXTRA',
  });
  check(
    replacementFailure.finished && replacementFailure.attempt?.status === 'reversal_failed' && finalClaim.claimed,
    'only the current lease may record failure and that failure remains retryable',
  );
  const terminalSuccess = db.finishOrderPaymentReversal(D, pendingAuthority.id, retryAuthority, {
    /* A delayed gateway success is still authoritative even after reclaim. */
    claimedAt: firstReversalClaim.attempt.reversalStartedAt,
    ok: true,
  });
  const failureAfterSuccess = db.finishOrderPaymentReversal(D, pendingAuthority.id, retryAuthority, {
    claimedAt: finalClaim.attempt.reversalStartedAt,
    ok: false,
    lastError: 'must not replace success',
  });
  check(
    terminalSuccess.finished && !failureAfterSuccess.finished &&
      db.getOrderPaymentAttempt(D, pendingAuthority.id, retryAuthority)?.status === 'reversed' &&
      db.getOrderPaymentAttempt(D, pendingAuthority.id, retryAuthority)?.reversalStartedAt === null &&
      db.clearOrderPaymentAttentionIfResolved(D, pendingAuthority.id) &&
      !db.getOrderById(D, pendingAuthority.id).needsAttention,
    'gateway success is terminal, clears its lease, and cannot be overwritten by a late failure',
  );
  const paidDelete = db.deleteOrder(D, pendingAuthority.id);
  check(
    !paidDelete.ok && db.getOrderById(D, pendingAuthority.id) &&
      db.listOrderPaymentAttempts(D, pendingAuthority.id).length === 2,
    'deletion cannot cascade away a settled attempt or its reversed retry evidence',
  );

  const protectedStockOrder = order({
    id: crypto.randomUUID(),
    code: `KY-PROTECTED-STOCK-${Date.now()}`,
    status: 'paid',
    provider: 'zarinpal',
    payAuthority: 'A-PROTECTED-STOCK',
    paidAt: new Date().toISOString(),
    items: [{ slug: 'protected-stock', title: 'Protected payment stock', unit: '', price: 1000, qty: 2, sum: 2000 }],
  });
  check(db.reserveStock(D, protectedStockOrder.items).ok, 'protected-delete fixture reserves inventory');
  db.insertOrder(D, protectedStockOrder);
  db.updateOrderPaymentAttempt(D, protectedStockOrder.id, 'A-PROTECTED-STOCK', {
    status: 'verified',
    refId: 'REF-PROTECTED-STOCK',
    verifiedAt: new Date().toISOString(),
  });
  const refusedProtectedDelete = db.deleteOrder(D, protectedStockOrder.id, { restoreInventory: true });
  check(
    !refusedProtectedDelete.ok &&
      db.getProduct(D, 'protected-stock').stock === 3 &&
      db.getOrderPaymentAttempt(D, protectedStockOrder.id, 'A-PROTECTED-STOCK')?.refId === 'REF-PROTECTED-STOCK',
    'a refused verified-order deletion cannot restore stock or cascade payment evidence',
  );

  /* Force a failure after the first UPDATE while reserveStock runs inside an
     outer transaction. The node:sqlite fallback must roll the inner writes
     back to a SAVEPOINT even though reserveStock catches and returns the
     error; otherwise nested-a would silently commit at 4. */
  D.exec(`
    CREATE TRIGGER fail_nested_second_update
    BEFORE UPDATE OF stock ON products
    WHEN OLD.slug = 'nested-b' AND NEW.stock < OLD.stock
    BEGIN
      SELECT RAISE(ABORT, 'forced nested reservation failure');
    END;
  `);
  let nestedFailure;
  D.transaction(() => {
    nestedFailure = db.reserveStock(D, [
      { slug: 'nested-a', qty: 1 },
      { slug: 'nested-b', qty: 1 },
    ]);
  })();
  check(!nestedFailure?.ok, 'nested reservation surfaces a forced second-write failure');
  check(
    db.getProduct(D, 'nested-a').stock === 5 && db.getProduct(D, 'nested-b').stock === 5,
    'nested SAVEPOINT rolls back every partial stock deduction',
  );
  D.exec('DROP TRIGGER fail_nested_second_update');

  const oversell = db.reserveStock(D, [
    { slug: 'limited', qty: 5 },
    { slug: 'limited', qty: 5 },
  ]);
  check(!oversell.ok && oversell.error === 'insufficient stock', 'duplicate lines are checked as one quantity');
  check(db.getProduct(D, 'limited').stock === 5, 'failed duplicate reservation is atomic');

  const valid = db.reserveStock(D, [
    { slug: 'limited', qty: 1 },
    { slug: 'limited', qty: 2 },
  ]);
  check(valid.ok, 'duplicate lines within stock can reserve');
  check(db.getProduct(D, 'limited').stock === 2, 'merged quantity is subtracted exactly once');
  db.restoreStock(D, [{ slug: 'limited', qty: 1 }, { slug: 'limited', qty: 2 }]);
  check(db.getProduct(D, 'limited').stock === 5, 'duplicate restoration also merges safely');

  const expiring = order();
  check(db.reserveStock(D, expiring.items).ok, 'expiry fixture reserves stock');
  db.insertOrder(D, expiring);
  check(db.getProduct(D, 'limited').stock === 2, 'pending order holds its stock');

  let duplicateInsertRejected = false;
  try {
    db.reserveAndInsertOrder(D, order({ id: expiring.id, code: `KY-CONFLICT-${Date.now()}`, items: [line('limited', 1)] }));
  } catch {
    duplicateInsertRejected = true;
  }
  check(duplicateInsertRejected, 'an order insert failure is surfaced');
  check(db.getProduct(D, 'limited').stock === 2, 'failed order insertion rolls its stock reservation back atomically');

  const expired = db.expirePendingOrders(D, new Date(Date.now() - 30 * 60 * 1000).toISOString());
  check(expired.length === 1 && expired[0].id === expiring.id, 'stale pending order is swept');
  const cancelled = db.getOrderById(D, expiring.id);
  check(cancelled.status === 'cancelled' && cancelled.autoCancelled, 'swept order records automatic cancellation');
  check(db.getProduct(D, 'limited').stock === 5, 'sweeper restores held stock');

  const again = db.expirePendingOrders(D, new Date().toISOString());
  check(again.length === 0, 'repeated sweeps do not cancel twice');
  check(db.getProduct(D, 'limited').stock === 5, 'repeated sweeps cannot mint stock');

  const late = order({
    id: crypto.randomUUID(),
    code: `KY-LATE-${Date.now()}`,
    provider: 'zarinpal',
    payAuthority: 'AUTH-LATE',
    items: [line('late', 3)],
  });
  check(db.reserveAndInsertOrder(D, late).ok, 'late-callback fixture is atomically reserved and inserted');
  db.recordOrderPaymentAttempt(D, late.id, { authority: 'AUTH-LATE-RETRY', provider: 'zarinpal' });
  check(db.expirePendingOrders(D, new Date().toISOString()).length === 1, 'late-callback fixture first expires');
  const lateClaim = db.claimExpiredPayment(D, late.id, {
    provider: 'zarinpal',
    authority: 'AUTH-LATE',
    payRef: 'verified-ref',
    paidAt: new Date().toISOString(),
    successNote: 'late success',
    failureNote: 'late failure',
  });
  check(lateClaim.ok && lateClaim.reserved, 'an earlier retry authority can reclaim available stock after expiry');
  check(
    db.getOrderById(D, late.id).status === 'paid' && db.getOrderById(D, late.id).payAuthority === 'AUTH-LATE',
    'claimed late payment becomes paid under the authority that actually settled',
  );
  check(!db.getOrderById(D, late.id).needsAttention, 'successful late-payment recovery clears its transient attention flag');
  check(db.getProduct(D, 'late').stock === 2, 'late-payment claim reserves its units exactly once');
  const duplicateClaim = db.claimExpiredPayment(D, late.id, {
    provider: 'zarinpal', authority: 'AUTH-LATE', payRef: 'again', paidAt: new Date().toISOString(), successNote: 'again', failureNote: 'again',
  });
  check(!duplicateClaim.ok && db.getProduct(D, 'late').stock === 2, 'duplicate callback cannot reserve late-payment stock twice');

  const lateEmpty = order({
    id: crypto.randomUUID(),
    code: `KY-LATE-EMPTY-${Date.now()}`,
    provider: 'zarinpal',
    payAuthority: 'AUTH-LATE-EMPTY',
    items: [line('late-empty', 3)],
  });
  check(db.reserveAndInsertOrder(D, lateEmpty).ok, 'no-stock late callback fixture starts with a valid hold');
  db.expirePendingOrders(D, new Date().toISOString());
  db.updateProductStock(D, 'late-empty', 2, 3); // units sold after the hold expired
  const noStockClaim = db.claimExpiredPayment(D, lateEmpty.id, {
    provider: 'zarinpal',
    authority: 'AUTH-LATE-EMPTY',
    payRef: 'late-no-stock',
    paidAt: new Date().toISOString(),
    successNote: 'unexpected success',
    failureNote: 'refund pending',
  });
  const claimedForRefund = db.getOrderById(D, lateEmpty.id);
  check(noStockClaim.ok && !noStockClaim.reserved, 'late payment without inventory is claimed for one refund worker');
  check(claimedForRefund.status === 'cancelled' && claimedForRefund.autoCancelled, 'refund-pending claim does not pretend to hold stock');
  check(claimedForRefund.adminNote === 'refund pending', 'refund-pending claim leaves an urgent durable note');
  check(claimedForRefund.needsAttention, 'unresolved late refund raises a durable attention flag before external refund work');
  check(!db.claimExpiredPayment(D, lateEmpty.id, {
    provider: 'zarinpal', authority: 'AUTH-LATE-EMPTY', payRef: 'duplicate', paidAt: new Date().toISOString(), successNote: 'duplicate', failureNote: 'duplicate',
  }).ok, 'a second worker cannot claim the same late refund');
  db.updateOrder(D, lateEmpty.id, { needsAttention: false });
  check(!db.getOrderById(D, lateEmpty.id).needsAttention, 'an explicit Admin acknowledgement clears the attention flag durably');

  const paid = order({ id: crypto.randomUUID(), code: `KY-PAID-${Date.now()}`, status: 'paid', paidAt: new Date().toISOString() });
  check(db.reserveStock(D, paid.items).ok, 'paid fixture reserves stock');
  db.insertOrder(D, paid);
  check(db.expirePendingOrders(D, new Date().toISOString()).length === 0, 'paid orders never expire');
  check(db.getProduct(D, 'limited').stock === 2, 'paid order keeps its reservation');

  const stale = db.updateProductStock(D, 'limited', 20, 5);
  check(!stale.ok && stale.error === 'stock changed' && stale.stock === 2, 'stale absolute inventory edit is rejected');
  const fresh = db.updateProductStock(D, 'limited', 20, 2);
  check(fresh.ok && db.getProduct(D, 'limited').stock === 20, 'fresh compare-and-set inventory edit succeeds');
  check(!db.updateProductStock(D, 'limited', -2, 20).ok, 'stock below -1 is rejected');

  check(db.reserveStock(D, [{ slug: 'unlimited', qty: 50_000 }]).ok, 'unlimited stock accepts a large valid claim');
  check(db.getProduct(D, 'unlimited').stock === -1, 'unlimited stock remains -1 after reserve');

  /* Prove the HTTP server actually invokes the sweeper at startup, including
     orders abandoned while Node was offline. */
  const bootExpiry = order({ id: crypto.randomUUID(), code: `KY-BOOT-${Date.now()}` });
  check(db.reserveStock(D, bootExpiry.items).ok, 'startup-sweep fixture reserves stock');
  db.insertOrder(D, bootExpiry);
  db.setSetting(D, 'seeded', new Date().toISOString());
  check(db.getProduct(D, 'limited').stock === 17, 'startup-sweep fixture holds three units');
  D.close();
  D = null;

  server = spawn('node', ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dir,
      DB_FILE: file,
      NODE_ENV: 'development',
      PUBLIC_ORIGIN: BASE,
    },
    stdio: 'ignore',
  });
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
    try {
      ready = (await fetch(`${BASE}/api/health`)).ok;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  check(ready, 'server starts for startup expiry check');
  if (ready) {
    const products = await (await fetch(`${BASE}/api/shop-products`)).json();
    check(products.products.find((product) => product.slug === 'limited')?.stock === 20, 'server startup sweep restores offline abandoned stock');
  }
} catch (error) {
  check(false, 'inventory harness', String(error?.stack || error).slice(0, 300));
} finally {
  try { server?.kill('SIGKILL'); } catch {}
  try { D?.close?.(); } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

console.log(`${pass}/${pass + fail}`);
if (fail) process.exitCode = 1;
