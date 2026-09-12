/* Boot a route against a malformed /api/content payload.

   content.json is hand-editable and written by the admin panel, so a row of
   the wrong shape is reachable without an attacker. Components dereference
   entity fields directly (card.slug, card.featured), so one bad row used to
   throw during render and blank the whole site. */
import { boot } from './dom.mjs';
const CASES = {
  'texts is string':    { texts: 'nope', media:{}, links:{}, products:[], posts:[] },
  'products is object': { texts:{}, media:{}, links:{}, products:{a:1}, posts:[] },
  'products null':      { texts:{}, media:{}, links:{}, products:null, posts:null },
  'product missing slug':{ texts:{}, media:{}, links:{}, products:[{title:'x'}], posts:[] },
  'product is null':    { texts:{}, media:{}, links:{}, products:[null], posts:[] },
  'posts is string':    { texts:{}, media:{}, links:{}, products:[], posts:'x' },
  'shop missing':       { texts:{}, media:{}, links:{}, products:[], posts:[] },
  'shop.products null': { texts:{}, media:{}, links:{}, products:[], posts:[], shop:{display:{},products:null} },
  'deeply empty':       {},
  'array at root':      [],
  'null at root':       null,
  'number at root':     42,
  'huge nesting':       JSON.parse('{"texts":'+'{"a":'.repeat(40)+'1'+'}'.repeat(40)+'}'),
};
const name = process.argv[2];
const r = await boot(process.argv[3]||'/', { wait: 2200, api: (u) => u.includes('/api/content') ? CASES[name] : undefined });
console.log(JSON.stringify({ chars: r.text.length, errors: r.errors.slice(0,2) }));
process.exit(0);
