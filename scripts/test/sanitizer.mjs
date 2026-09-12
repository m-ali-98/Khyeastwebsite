import { parseHTML, DOMParser as LD } from 'linkedom';
const { window } = parseHTML('<!doctype html><html><body></body></html>');
globalThis.DOMParser = LD; globalThis.document = window.document;
const { sanitizeHtml } = await import('../src/content/sanitize.jsx').catch(async()=>{
  const src = (await import('node:fs')).readFileSync(new URL('../../src/content/sanitize.jsx', import.meta.url),'utf8');
  const js = src.replace(/export function renderHighlight[\s\S]*$/, '');
  const mod = await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  return mod;
});
const CASES = [
  ['script tag',              '<script>alert(1)</script>hello'],
  ['img onerror',             '<img src="/a.png" onerror="alert(1)">'],
  ['svg onload',              '<svg onload="alert(1)"><circle/></svg>'],
  ['javascript: href',        '<a href="javascript:alert(1)">x</a>'],
  ['JaVaScRiPt: href',        '<a href="JaVaScRiPt:alert(1)">x</a>'],
  ['js with tab',             '<a href="java\tscript:alert(1)">x</a>'],
  ['js with newline',         '<a href="java\nscript:alert(1)">x</a>'],
  ['js with NULL',            '<a href="java\0script:alert(1)">x</a>'],
  ['leading-space js',        '<a href="  javascript:alert(1)">x</a>'],
  ['data: uri img',           '<img src="data:text/html;base64,PHNjcmlwdD4=">'],
  ['data: svg xss',           '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">'],
  ['protocol-relative',       '<img src="//evil.com/x.png">'],
  ['iframe',                  '<iframe src="https://evil.com"></iframe>'],
  ['style tag',               '<style>body{display:none}</style>'],
  ['style attr',              '<p style="position:fixed;inset:0">x</p>'],
  ['class attr',              '<p class="nav__logo">x</p>'],
  ['onclick',                 '<p onclick="alert(1)">x</p>'],
  ['form',                    '<form action="//evil"><input name=a></form>'],
  ['object/embed',            '<object data="x"></object><embed src="y">'],
  ['meta refresh',            '<meta http-equiv="refresh" content="0;url=//evil">'],
  ['base tag',                '<base href="//evil/">'],
  ['nested script in p',      '<p><script>alert(1)</script></p>'],
  ['mXSS comment',            '<!--<img src="--><img src=x onerror=alert(1)//">'],
  ['unclosed script',         '<script>alert(1)'],
  ['srcset',                  '<img src="/a.png" srcset="//evil 1x">'],
  ['video onerror',           '<video src="/a.mp4" onerror="alert(1)"></video>'],
  ['formaction',              '<button formaction="javascript:alert(1)">x</button>'],
  ['a target no rel',         '<a href="https://x.com">x</a>'],
  ['script inside disallowed', '<span><script>alert(1)</script></span>'],
  ['nested unwrap w/ script',  '<div><span><b><script>alert(1)</script></b></span></div>'],
  ['onerror inside unwrap',    '<span><img src="/a.png" onerror="alert(1)"></span>'],
  ['deep unwrap + handler',    '<span>'.repeat(20)+'<img src=x onerror=alert(1)>'+'</span>'.repeat(20)],
  ['iframe inside span',       '<span><iframe src="//evil"></iframe></span>'],
  ['js href inside unwrap',    '<span><a href="javascript:alert(1)">x</a></span>'],
  ['bad src removes img',      '<span><img src="data:text/html,<script>alert(1)</script>"></span>'],
  ['table unwrap keeps text',  '<table><tr><td>text</td></tr></table>'],
  ['legit content',           '<p>سلام <strong>دنیا</strong> <a href="/products">لینک</a></p>'],
];
const BAD = /on\w+\s*=|<script|<iframe|<style|<object|<embed|<form|<meta|<base|javascript:|data:text|data:image\/svg|srcset|formaction|style=|class=/i;
let fails = 0;
for (const [name, input] of CASES) {
  let out;
  try { out = sanitizeHtml(input); } catch (e) { out = 'THREW: ' + e.message; }
  const leaked = BAD.test(out) || out.startsWith('THREW');
  if (leaked) fails++;
  console.log(`${leaked ? 'LEAK' : 'ok  '} ${name.padEnd(20)} -> ${out.slice(0, 74)}`);
}
console.log(`\n${CASES.length - fails}/${CASES.length} sanitizer cases safe`);
