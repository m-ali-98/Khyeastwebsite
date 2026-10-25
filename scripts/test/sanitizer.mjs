import { parseHTML, DOMParser as LD } from 'linkedom';
import {
  sanitizeHtmlWithParser,
  sanitizeHtmlResultWithParser,
  MAX_HTML_INPUT_LENGTH,
  MAX_HTML_DEPTH,
  MAX_HTML_NODES,
} from '../../shared/sanitizeHtml.js';
import { sanitizeContentPayload } from '../../server/sanitize.js';
const { window } = parseHTML('<!doctype html><html><body></body></html>');
globalThis.document = window.document;
const sanitizeHtml = (html) => sanitizeHtmlWithParser(html, LD);
const CASES = [
  ['script tag',              '<script>alert(1)</script>hello'],
  ['img onerror',             '<img src="/a.png" onerror="alert(1)">'],
  ['svg onload',              '<svg onload="alert(1)"><circle/></svg>'],
  ['javascript: href',        '<a href="javascript:alert(1)">x</a>'],
  ['uppercase HREF',          '<a HREF="javascript:alert(1)">x</a>'],
  ['JaVaScRiPt: href',        '<a href="JaVaScRiPt:alert(1)">x</a>'],
  ['js with tab',             '<a href="java\tscript:alert(1)">x</a>'],
  ['js with newline',         '<a href="java\nscript:alert(1)">x</a>'],
  ['js with NULL',            '<a href="java\0script:alert(1)">x</a>'],
  ['leading-space js',        '<a href="  javascript:alert(1)">x</a>'],
  ['data: uri img',           '<img src="data:text/html;base64,PHNjcmlwdD4=">'],
  ['data: svg xss',           '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">'],
  ['protocol-relative',       '<img src="//evil.com/x.png">'],
  ['anchor protocol-relative','<a href="//evil.com">x</a>'],
  ['protocol-relative base',  '<a href="//khyeast.invalid/path">x</a>'],
  ['anchor slash-backslash',  '<a href="/\\evil.com">x</a>'],
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
  ['malformed --!> comment',  '<!-- a --!><img src=x onerror=alert(1)>-->'],
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
  /* --- mutation XSS: markup that changes meaning when the browser re-parses
     the sanitizer's own output. These are the vectors that defeat naive
     regex-based cleaners. --- */
  ['mXSS noscript',           '<noscript><p title="</noscript><img src=x onerror=alert(1)>">'],
  ['mXSS noembed',            '<noembed><img src=x onerror=alert(1)></noembed>'],
  ['mXSS textarea escape',    '<textarea></textarea><img src=x onerror=alert(1)>'],
  ['mXSS title escape',       '<title></title><img src=x onerror=alert(1)>'],
  ['mXSS comment straddle',   '<p>a<!--</p><img src=x onerror=alert(1)>-->b</p>'],
  /* --- namespace confusion: SVG and MathML parse by different rules, so HTML
     that is inert in one context becomes live in the other. --- */
  ['svg foreignObject',       '<svg><foreignObject><iframe src="//evil"></iframe></foreignObject></svg>'],
  ['svg animate href',        '<svg><a><animate attributeName="href" values="javascript:alert(1)"/></a></svg>'],
  ['svg use xlink',           '<svg><use xlink:href="data:image/svg+xml;base64,PHN2Zz4="/></svg>'],
  ['math annotation-xml',     '<math><annotation-xml encoding="text/html"><img src=x onerror=alert(1)></annotation-xml></math>'],
  /* --- raw-text elements whose contents are not parsed as markup --- */
  ['template content',        '<template><img src=x onerror=alert(1)></template>'],
  ['plaintext',               '<plaintext><img src=x onerror=alert(1)>'],
  /* --- alternative script-bearing protocols and attributes --- */
  ['vbscript href',           '<a href="vbscript:msgbox(1)">x</a>'],
  ['blob href',               '<a href="blob:https://evil.com/uuid">x</a>'],
  ['filesystem href',         '<a href="filesystem:http://e/temporary/x">x</a>'],
  ['autofocus onfocus',       '<input autofocus onfocus="alert(1)">'],
  ['details ontoggle',        '<details open ontoggle="alert(1)">x</details>'],
  ['marquee onstart',         '<marquee onstart="alert(1)">x</marquee>'],
  ['bgsound src js',          '<bgsound src="javascript:alert(1)">'],
  ['link rel=import',         '<link rel="import" href="//evil">'],
  ['is= custom element',      '<p is="evil-el">x</p>'],
  /* --- attribute-boundary escapes: the payload must stay inside its quotes --- */
  ['attr quote breakout',     '<img src="/a.png" alt=\'" onerror="alert(1)\'>'],
  ['attr entity breakout',    '<img src="/a.png" alt="&quot; onerror=&quot;alert(1)">'],
  ['attr tag breakout',       '<img src="/a.png" alt="</title><script>alert(1)</script>">'],
  ['null byte in tag name',   '<scr\0ipt>alert(1)</scr\0ipt>'],
  ['huge attr name',          '<img src="/a.png" '+'a'.repeat(5000)+'=1>'],
  ['20k nested allowed tags', '<b>'.repeat(20_000) + 'x' + '</b>'.repeat(20_000)],
  ['oversized input cap',     `<p>${'x'.repeat(MAX_HTML_INPUT_LENGTH + 1)}</p>`],
  /* Exercise the actual persistence boundary, not only the shared helper. */
  ['stored post uppercase',   '<a HREF="javascript:alert(1)">x</a>', (input) => (
    sanitizeContentPayload({ posts: [{ body: input }] }).posts[0].body
  )],
  ['stored product comment',  '<!-- a --!><img src=x onerror=alert(1)>-->', (input) => (
    sanitizeContentPayload({ shop: { products: [{ description: input }] } }).shop.products[0].description
  )],
];
/* A regex over the output string cannot tell live markup from escaped text:
   `alt="&lt;script&gt;"` contains the characters of a script tag but is inert.
   So the verdict comes from re-parsing the sanitizer's output as HTML — the
   same thing the browser does — and inspecting the resulting tree. This also
   catches mutation XSS, where markup only turns dangerous on that second
   parse. The string regex is kept as a cheap second opinion for the things a
   tree walk cannot see, like a javascript: URL sitting in an allowed href. */
const FORBIDDEN_TAGS = new Set([
  'script', 'iframe', 'style', 'object', 'embed', 'form', 'meta', 'base',
  'link', 'noscript', 'noembed', 'template', 'svg', 'math', 'marquee',
  'bgsound', 'plaintext', 'input', 'button', 'details',
]);
const BAD_URL = /^\s*(javascript|vbscript|data|blob|filesystem)\s*:/i;

function inspect(html) {
  const doc = new LD().parseFromString(`<body>${html}</body>`, 'text/html');
  const problems = [];
  const pending = [...doc.childNodes];
  while (pending.length) {
    const node = pending.pop();
    if (node.nodeType === 8) problems.push('<!--comment-->');
    pending.push(...(node.childNodes || []));
  }
  for (const el of doc.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    if (FORBIDDEN_TAGS.has(tag)) problems.push(`<${tag}>`);
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      /* Event handlers, inline styling, and class hooks into site CSS. */
      if (/^on/.test(n)) problems.push(`${tag}[${n}]`);
      if (n === 'style' || n === 'class' || n === 'is' || n.startsWith('xlink:')) problems.push(`${tag}[${n}]`);
      if (/^(href|src|action|formaction|srcset|data)$/.test(n) && BAD_URL.test(attr.value)) {
        /* data: is legitimate for raster images only. */
        const inlineImg = n === 'src' && tag === 'img' && /^data:image\/(png|jpe?g|gif|webp);/i.test(attr.value);
        if (!inlineImg) problems.push(`${tag}[${n}=${attr.value.slice(0, 24)}]`);
      }
      if (/^(href|src)$/.test(n) && (/^\/\//.test(attr.value) || attr.value.includes('\\'))) {
        problems.push(`${tag}[${n}=external-confusion]`);
      }
    }
  }
  return problems;
}

let fails = 0;
for (const [name, input, run = sanitizeHtml] of CASES) {
  let out;
  try { out = String(run(input) ?? ''); } catch (e) { out = 'THREW: ' + e.message; }

  /* Sanitize the output a second time: a stable sanitizer must reach a fixed
     point, and anything that only becomes dangerous on re-parse shows up here. */
  let again;
  try { again = String(sanitizeHtml(out) ?? ''); } catch (e) { again = 'THREW: ' + e.message; }

  const problems = [...inspect(out), ...inspect(again)];
  const leaked = problems.length > 0 || out.startsWith('THREW') || again.startsWith('THREW');
  if (leaked) fails++;
  const why = problems.length ? ` [${[...new Set(problems)].join(' ')}]` : '';
  console.log(`${leaked ? 'LEAK' : 'ok  '} ${name.padEnd(22)} -> ${out.slice(0, 60)}${why}`);
}

const strictCases = [
  ['persistence rejects oversized HTML', 'x'.repeat(MAX_HTML_INPUT_LENGTH + 1), 'input-too-large'],
  ['persistence rejects excess nodes', '<br>'.repeat(MAX_HTML_NODES + 1), 'node-limit'],
  [
    'persistence rejects excess depth',
    '<strong>'.repeat(MAX_HTML_DEPTH + 1) + 'x' + '</strong>'.repeat(MAX_HTML_DEPTH + 1),
    'depth-limit',
  ],
];
for (const [name, body, expectedCode] of strictCases) {
  let error;
  try {
    sanitizeContentPayload({ posts: [{ slug: 'bounded', body }] });
  } catch (caught) {
    error = caught;
  }
  const passed = error?.status === 400 && error?.code === expectedCode && error?.field?.includes('body');
  if (!passed) fails += 1;
  console.log(`${passed ? 'ok  ' : 'LEAK'} ${name.padEnd(38)} -> ${error?.code || 'accepted'}`);
}

const emptyButValid = sanitizeContentPayload({ posts: [{ body: '<script>removed</script>' }] });
const emptyPassed = emptyButValid.posts[0].body === '';
if (!emptyPassed) fails += 1;
console.log(`${emptyPassed ? 'ok  ' : 'LEAK'} ${'valid sanitized-empty HTML is accepted'.padEnd(38)} -> ${JSON.stringify(emptyButValid.posts[0].body)}`);

class BrokenParser {
  parseFromString() { throw new Error('synthetic parser failure'); }
}
const parserResult = sanitizeHtmlResultWithParser('<p>x</p>', BrokenParser);
const parserPassed = !parserResult.ok && parserResult.code === 'parser-error';
if (!parserPassed) fails += 1;
console.log(`${parserPassed ? 'ok  ' : 'LEAK'} ${'parser failure has a distinct result'.padEnd(38)} -> ${parserResult.code}`);

const total = CASES.length + strictCases.length + 2;
console.log(`\n${total - fails}/${total} sanitizer cases safe`);
