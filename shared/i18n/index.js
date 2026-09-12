/* ==========================================================================
   Locale registry + state localisation.
   --------------------------------------------------------------------------
   Persian is the base language: shared/contentDefaults.js holds the canonical
   structure and every Persian value. English and Arabic are *overlays* — they
   only carry the values that differ, so a key that has not been translated
   yet still renders (in Persian) instead of disappearing.

   Precedence, lowest to highest:
     1. contentDefaults.js          (Persian, always complete)
     2. shared/i18n/<locale>.js     (shipped translation)
     3. state.i18n[locale]          (translations edited in the admin panel)

   The admin panel therefore never has to re-enter a whole language: it edits
   a thin override layer on top of the shipped translation.
   ========================================================================== */

export const LOCALES = [
  { code: 'fa', label: 'فارسی', short: 'FA', dir: 'rtl', htmlLang: 'fa', prefix: '' },
  { code: 'en', label: 'English', short: 'EN', dir: 'ltr', htmlLang: 'en', prefix: '/en' },
  { code: 'ar', label: 'العربية', short: 'AR', dir: 'rtl', htmlLang: 'ar', prefix: '/ar' },
];

export const LOCALE_CODES = LOCALES.map((l) => l.code);
export const DEFAULT_LOCALE = 'fa';
export const getLocaleMeta = (code) => LOCALES.find((l) => l.code === code) || LOCALES[0];

/** The online shop is a domestic (Iranian) offering — Persian site only. */
export const shopEnabled = (locale) => locale === 'fa';

/* ---------------------------------------------------------------------------
   Translation packs are loaded on demand: a Persian visitor never downloads
   the English or Arabic dictionaries, and each non-Persian site downloads
   only its own. `loadPack` is awaited once at boot, before React renders.
   --------------------------------------------------------------------------- */
const LOADERS = {
  en: () => import('./en.js'),
  ar: () => import('./ar.js'),
};

const PACKS = {};

const toPack = (ns) => ({
  texts: ns.TEXTS,
  collections: ns.COLLECTIONS,
  brands: ns.BRANDS,
  products: ns.PRODUCTS,
  posts: ns.POSTS,
});

export async function loadPack(locale) {
  if (locale === DEFAULT_LOCALE || PACKS[locale]) return PACKS[locale] || null;
  const load = LOADERS[locale];
  if (!load) return null;
  try {
    PACKS[locale] = toPack(await load());
  } catch {
    PACKS[locale] = null;
  }
  return PACKS[locale];
}

/** Load every pack — used by the admin panel, which edits all languages. */
export async function loadAllPacks() {
  await Promise.all(Object.keys(LOADERS).map(loadPack));
  return PACKS;
}

export const getPack = (locale) => PACKS[locale] || null;

/* ---------------------------------------------------------------- helpers */

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Overlay `over` onto `base` for a flat string map. Empty strings are ignored
    so an admin can blank a field without losing the fallback. */
function overlayMap(base, ...overs) {
  const out = { ...(base || {}) };
  for (const over of overs) {
    if (!isObj(over)) continue;
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined || v === null || v === '') continue;
      out[k] = v;
    }
  }
  return out;
}

/** Overlay a list positionally. Collections keep their length and their
    non-translatable fields (`value`, `icon`, `id`, `year`…); entries that are
    plain strings (e.g. the contact-form `subjects`) are replaced wholesale. */
function overlayList(base, ...overs) {
  if (!Array.isArray(base)) return base;
  return base.map((item, i) => {
    let out = isObj(item) ? { ...item } : item;
    for (const over of overs) {
      const o = Array.isArray(over) ? over[i] : undefined;
      if (o === undefined || o === null || o === '') continue;
      if (typeof o === 'string') {
        /* a translated plain-string entry */
        if (!isObj(out)) out = o;
        continue;
      }
      if (!isObj(o)) continue;
      if (!isObj(out)) continue;
      for (const [k, v] of Object.entries(o)) {
        if (v === undefined || v === null || v === '') continue;
        out[k] = v;
      }
    }
    return out;
  });
}

function overlayCollections(base, ...overs) {
  const out = {};
  for (const [key, list] of Object.entries(base || {})) {
    out[key] = overlayList(list, ...overs.map((o) => (isObj(o) ? o[key] : undefined)));
  }
  return out;
}

/** Overlay entities addressed by a key (slug / id) rather than by position. */
function overlayEntities(base, keyName, ...overs) {
  if (!Array.isArray(base)) return base;
  /* Drop entries that are not usable objects. A null or primitive in this
     array reaches every consumer — cards read .slug, .featured, .image — and
     one bad row would otherwise blank the entire site rather than hide a
     single product. content.json is editable by hand and by the admin panel,
     so this is reachable without any attacker. */
  return base.filter(isObj).map((item) => {
    const id = item?.[keyName];
    let out = { ...item };
    for (const over of overs) {
      const o = isObj(over) ? over[id] : undefined;
      if (!isObj(o)) continue;
      for (const [k, v] of Object.entries(o)) {
        if (v === undefined || v === null || v === '') continue;
        out[k] = v;
      }
    }
    return out;
  });
}

/* ------------------------------------------------------------------- main */

/**
 * Produce the content state as seen by one locale.
 * @param {object} state   the full content state (Persian base + `i18n` overrides)
 * @param {string} locale  'fa' | 'en' | 'ar'
 */
export function localizeState(state, locale) {
  if (!state) return state;
  if (locale === DEFAULT_LOCALE) return state;

  const pack = PACKS[locale];
  const admin = isObj(state.i18n) ? state.i18n[locale] : null;
  if (!pack && !admin) return state;

  const p = pack || {};
  const a = admin || {};

  return {
    ...state,
    texts: overlayMap(state.texts, p.texts, a.texts),
    collections: overlayCollections(state.collections, p.collections, a.collections),
    brands: overlayEntities(state.brands, 'id', p.brands, a.brands),
    products: overlayEntities(state.products, 'slug', p.products, a.products),
    posts: overlayEntities(state.posts, 'slug', p.posts, a.posts),
  };
}

export default {
  LOCALES,
  LOCALE_CODES,
  DEFAULT_LOCALE,
  localizeState,
  getLocaleMeta,
  shopEnabled,
  getPack,
  loadPack,
  loadAllPacks,
};
