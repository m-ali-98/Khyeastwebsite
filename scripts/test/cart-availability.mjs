/* ==========================================================================
   Persisted-cart reconciliation checks.

   Inventory is mutable while localStorage is not. These checks pin the pure
   boundary that removes deleted/deactivated/sold-out lines, clamps reduced
   stock, and leaves an exact explanation for the UI before checkout.
   ========================================================================== */
import { reconcileCart, productOrderLimit, MAX_CART_QUANTITY } from '../../shared/cartAvailability.js';

let pass = 0;
let fail = 0;
const check = (ok, name, detail = '') => {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`LEAK ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const product = (slug, over = {}) => ({
  slug,
  title: `Product ${slug}`,
  active: true,
  price: 1000,
  stock: 10,
  ...over,
});

const catalogue = [
  product('normal'),
  product('low', { stock: 2 }),
  product('sold-out', { stock: 0 }),
  product('inactive', { active: false }),
  product('unlimited', { stock: -1 }),
  product('bad-stock', { stock: -2 }),
  product('bad-price', { price: 0 }),
];

{
  const result = reconcileCart({ normal: 3 }, catalogue);
  check(result.changed === false, 'an already valid cart is unchanged');
  check(JSON.stringify(result.cart) === '{"normal":3}', 'a valid quantity is retained');
  check(result.rows.length === 1 && result.rows[0].quantity === 3, 'a valid row is returned');
  check(result.rows[0].lineTotal === 3000, 'line totals use the reconciled quantity');
  check(result.rows[0].limit === 10, 'each row carries its safe stepper limit');
  check(result.changes.length === 0, 'a valid cart produces no customer warning');
}

{
  const result = reconcileCart({ low: 7 }, catalogue);
  const change = result.changes[0];
  check(result.changed && result.cart.low === 2, 'quantity is clamped to reduced live stock');
  check(change.kind === 'adjusted' && change.reason === 'stock_reduced', 'reduced stock has a specific explanation');
  check(change.from === 7 && change.to === 2 && change.available === 2, 'the explanation keeps before and after quantities');
}

for (const [slug, reason] of [
  ['sold-out', 'out_of_stock'],
  ['inactive', 'inactive'],
  ['missing', 'missing'],
  ['bad-stock', 'unavailable'],
  ['bad-price', 'unavailable'],
]) {
  const result = reconcileCart({ [slug]: 1 }, catalogue);
  check(!Object.hasOwn(result.cart, slug), `${slug} is removed`);
  check(result.changes[0]?.reason === reason, `${slug} reports ${reason}`, result.changes[0]?.reason);
}

{
  const known = [product('deleted', { title: 'Remembered title' })];
  const result = reconcileCart({ deleted: 2 }, catalogue, { knownProducts: known });
  check(result.changes[0]?.title === 'Remembered title', 'a deleted line retains its known title for the notice');
  check(result.changes[0]?.reason === 'missing', 'historical metadata cannot make a deleted product orderable');
}

{
  const result = reconcileCart({ unlimited: 1000000 }, catalogue);
  check(result.cart.unlimited === MAX_CART_QUANTITY, 'unlimited stock still observes the cart safety cap');
  check(result.changes[0]?.reason === 'quantity_repaired', 'a safety-cap repair is distinguished from reduced stock');
  check(productOrderLimit(catalogue.find((item) => item.slug === 'unlimited')) === 999, 'the unlimited stepper cap is explicit');
}

{
  const result = reconcileCart({ normal: '2' }, catalogue);
  check(result.cart.normal === 2 && result.changed, 'a numeric string is normalized to an integer');
  check(result.changes[0]?.reason === 'quantity_repaired', 'normalization is explained');
}

for (const quantity of [0, -4, null, 'not-a-number']) {
  const result = reconcileCart({ normal: quantity }, catalogue);
  check(!Object.hasOwn(result.cart, 'normal'), `invalid quantity ${String(quantity)} is removed`);
  check(result.changes[0]?.reason === 'invalid_quantity', `invalid quantity ${String(quantity)} is identified`);
}

{
  const result = reconcileCart({ normal: 2.7 }, catalogue);
  check(result.cart.normal === 3, 'a fractional persisted quantity is repaired deterministically');
  check(result.changed, 'a fractional quantity is persisted in repaired form');
}

{
  const mixed = reconcileCart({ normal: 4, low: 9, 'sold-out': 1, gone: 2 }, catalogue);
  check(JSON.stringify(mixed.cart) === '{"normal":4,"low":2}', 'mixed carts keep only orderable quantities');
  check(mixed.rows.every((row) => row.quantity > 0 && row.quantity <= row.limit), 'no returned row can exceed its live limit');
  check(mixed.changes.length === 3, 'every affected mixed-cart line is explained once');
}

{
  const hostile = JSON.parse('{"__proto__":2,"normal":1}');
  const result = reconcileCart(hostile, catalogue);
  check(result.cart.normal === 1 && !Object.hasOwn(result.cart, '__proto__'), 'a prototype-looking slug is discarded safely');
  check({}.polluted === undefined, 'cart reconciliation does not pollute Object.prototype');
}

check(productOrderLimit(product('zero', { stock: 0 })) === 0, 'zero stock has a zero order limit');
check(productOrderLimit(product('off', { active: false })) === 0, 'inactive products have a zero order limit');
check(productOrderLimit(product('invalid', { stock: Number.NaN })) === 0, 'invalid stock fails closed');
check(productOrderLimit(null) === 0, 'a missing product fails closed');

console.log(`${pass}/${pass + fail}`);
if (fail) process.exit(1);
