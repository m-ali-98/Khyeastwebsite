/* Reusable DOM harness: boots the built bundle at a given URL and reports
   what rendered plus every error thrown. */
import fs from 'node:fs';
import { parseHTML, DOMParser as LDOMParser } from 'linkedom';

export async function boot(pathname, opts = {}) {
  const root = new URL('../../', import.meta.url);
  const html = fs.readFileSync(new URL('dist/index.html', root), 'utf8');
  const { window } = parseHTML(html);
  const loc = {
    pathname, search: opts.search || '', hash: '',
    href: 'http://localhost' + pathname + (opts.search || ''),
    origin: 'http://localhost', protocol: 'http:', host: 'localhost',
    hostname: 'localhost', assign(){}, replace(){}, reload(){},
  };
  try { Object.defineProperty(window, 'location', { value: loc, writable: true, configurable: true }); } catch {}
  const g = globalThis;
  const def = (k, v) => { try { Object.defineProperty(g, k, { value: v, writable: true, configurable: true }); } catch {} };
  for (const k of ['HTMLElement','Node','Element','Event','CustomEvent','getComputedStyle','DocumentFragment','SVGElement'])
    if (window[k] !== undefined) def(k, window[k]);
  def('window', window); def('document', window.document); def('location', loc);
  const hist = [];
  def('history', { pushState(s,t,u){hist.push(u)}, replaceState(s,t,u){hist.push(u)}, back(){}, forward(){}, go(){}, state:null, length:1 });
  def('navigator', { userAgent:'node', language:'fa', languages:['fa'], onLine:true, connection: opts.connection });
  def('requestAnimationFrame', (cb)=>setTimeout(()=>cb(Date.now()),0));
  def('cancelAnimationFrame', (id)=>clearTimeout(id));
  def('requestIdleCallback', (cb)=>setTimeout(()=>cb({didTimeout:false,timeRemaining:()=>0}),0));
  def('cancelIdleCallback', (id)=>clearTimeout(id));
  def('matchMedia', () => ({ matches:false, media:'', addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }));
  const store = { ...(opts.storage||{}) };
  def('localStorage', { getItem:(k)=>store[k]??null, setItem:(k,v)=>{store[k]=String(v)}, removeItem:(k)=>{delete store[k]}, clear:()=>{for(const k in store)delete store[k]}, key:(i)=>Object.keys(store)[i]??null, get length(){return Object.keys(store).length} });
  def('sessionStorage', g.localStorage);
  def('IntersectionObserver', class { constructor(cb){this.cb=cb} observe(){} unobserve(){} disconnect(){} takeRecords(){return[]} });
  def('ResizeObserver', class { observe(){} unobserve(){} disconnect(){} });
  def('MutationObserver', class { observe(){} disconnect(){} takeRecords(){return[]} });
  def('DOMParser', LDOMParser);
  def('scrollTo', ()=>{}); window.scrollTo = ()=>{};
  window.scrollY = 0; window.innerWidth = 1280; window.innerHeight = 900;

  const fetches = [];
  def('fetch', async (u, init) => {
    fetches.push(String(u));
    const r = opts.api?.(String(u), init);
    if (r) return { ok:true, status:200, headers:{get:()=>'application/json'}, json: async()=>r, text: async()=>JSON.stringify(r) };
    return { ok:false, status:503, headers:{get:()=>null}, json: async()=>({}), text: async()=>'' };
  });

  const errors = [];
  const warns = [];
  const oe = console.error, ow = console.warn;
  console.error = (...a) => errors.push(a.map(x=>x?.message||String(x)).join(' '));
  console.warn  = (...a) => warns.push(a.map(x=>x?.message||String(x)).join(' '));
  const onUnc = (e) => errors.push('UNCAUGHT: ' + (e?.message||e));
  const onRej = (e) => errors.push('REJECTED: ' + (e?.message||e));
  process.on('uncaughtException', onUnc);
  process.on('unhandledRejection', onRej);

  const assetDir = new URL('dist/assets/', root);
  const entry = fs.readdirSync(assetDir).find(f => /^index-.*\.js$/.test(f));
  try {
    await import(new URL(entry, assetDir).href);
  } catch (e) { errors.push('IMPORT THREW: ' + e.message); }
  await new Promise(r => setTimeout(r, opts.wait || 700));

  console.error = oe; console.warn = ow;
  process.off('uncaughtException', onUnc);
  process.off('unhandledRejection', onRej);

  const el = window.document.getElementById('root');
  const text = (el?.textContent||'').replace(/\s+/g,' ').trim();
  const real = errors.filter(e => !/not wrapped in act|ReactDOM\.render is no longer|validateDOMNesting/i.test(e));
  return { window, doc: window.document, root: el, text, errors: real, warns, fetches, history: hist };
}
