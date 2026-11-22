/* Boot /shop/cart with a specific (possibly corrupt) cart in localStorage. */
import { boot } from './dom.mjs';

const r = await boot('/shop/cart', {
  storage: { ky_shop_cart_v1: process.argv[2] },
  wait: 2200,
});

console.log(JSON.stringify({ chars: r.text.length, errors: r.errors.slice(0, 2) }));
process.exit(0);
