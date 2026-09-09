/* ==========================================================================
   Motion capability tiers.
   --------------------------------------------------------------------------
   One decision, made once, read everywhere — by JS *and* by CSS.

   The old check only looked at the network, which says nothing about whether
   the device can actually composite a frame in 16 ms. A cheap Android phone
   on office WiFi was getting the full treatment: parallax on every scroll
   frame, 22 infinitely animating particles, a 26 s Ken Burns pan over a
   full-bleed photo and six backdrop-filters.

   Tiers
     full     — animate freely
     reduced  — keep the choreography, drop the always-on and per-frame work
     minimal  — opacity only, no movement (also what reduced-motion users get)

   The tier is written to <html data-motion="…"> before first paint, so the
   stylesheet can switch off the expensive effects without JS ever running.
   ========================================================================== */

export const TIERS = ['full', 'reduced', 'minimal'];

/* Detection is intentionally conservative: every signal is optional and a
   missing signal never downgrades. Guessing "slow" on a fast device is a far
   worse outcome than the reverse, because the site then looks broken-cheap on
   perfectly capable hardware. */
export function detectTier() {
  if (typeof window === 'undefined') return 'full';

  const mm = window.matchMedia;
  if (mm?.('(prefers-reduced-motion: reduce)')?.matches) return 'minimal';

  const conn = navigator.connection || {};
  const mem = navigator.deviceMemory;          // GiB, Chromium only
  const cores = navigator.hardwareConcurrency; // logical cores

  /* Data Saver is an explicit "spend less on my behalf" request. */
  if (conn.saveData === true) return 'minimal';

  /* 2G class links usually pair with low-end hardware, and the page is going
     to feel slow regardless — spend nothing on decoration. */
  if (/(^|-)2g$/.test(conn.effectiveType || '')) return 'minimal';

  /* Genuinely weak hardware: <=2 GiB RAM or <=2 cores. Chromium clamps
     deviceMemory to 0.25–8 and hardwareConcurrency is widely supported. */
  if ((typeof mem === 'number' && mem <= 2) || (typeof cores === 'number' && cores <= 2)) {
    return 'minimal';
  }

  /* Mid-range: 4 GiB / 4 cores, or a 3G link. Keep the design's character but
     stop paying for continuous work. */
  if ((typeof mem === 'number' && mem <= 4) || (typeof cores === 'number' && cores <= 4)) {
    return 'reduced';
  }
  if (conn.effectiveType === '3g') return 'reduced';

  return 'full';
}

/** Apply the tier to <html> so CSS can react to it. */
export function applyTier(tier) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-motion', tier);
}

export function currentTier() {
  if (typeof document === 'undefined') return 'full';
  return document.documentElement.getAttribute('data-motion') || 'full';
}

export const isMinimal = () => currentTier() === 'minimal';
export const isFull = () => currentTier() === 'full';

/* ------------------------------------------------------------------ */
/*  Shared scroll observer                                             */
/* ------------------------------------------------------------------ */
/*  Reveal used to mount a framer-motion component per element: 63 of them on
    a long page, each with its own IntersectionObserver and its own JS
    animation loop. One observer for the whole document, handing off to a CSS
    transition, is dramatically cheaper and — because the browser can run the
    transition on the compositor — visibly smoother.                          */

let observer = null;

/* Every .reveal starts at opacity 0, so a broken observer would blank the
   page. Arm a one-shot watchdog the first time we observe anything: if the
   document is interactive and something is still hidden well after load, give
   up on the effect and show everything. */
let watchdog = false;
function armWatchdog() {
  if (watchdog || typeof window === 'undefined') return;
  watchdog = true;
  window.setTimeout(() => {
    const stuck = document.querySelector('.reveal:not(.is-in)');
    if (!stuck) return;
    const box = stuck.getBoundingClientRect();
    /* only a real failure looks like this: an element inside the viewport
       that the observer should already have flipped */
    if (box.top < window.innerHeight && box.bottom > 0) {
      document.documentElement.classList.add('reveal-failsafe');
    }
  }, 3000);
}

function ensureObserver() {
  if (observer || typeof IntersectionObserver === 'undefined') return observer;

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        el.classList.add('is-in');
        /* will-change is a promise to the compositor, not a free win — holding
           it forever keeps a layer alive per element. Drop it once the
           transition has finished. */
        const clear = () => {
          el.style.willChange = '';
          el.removeEventListener('transitionend', clear);
        };
        el.addEventListener('transitionend', clear);
        observer.unobserve(el);
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.01 }
  );

  return observer;
}

/** Observe one element; returns a cleanup function. */
export function observeReveal(el) {
  if (!el) return () => {};

  /* No observer support, or motion is off: show it immediately rather than
     leaving it stuck at opacity 0. */
  const obs = ensureObserver();
  if (!obs) {
    el.classList.add('is-in');
    return () => {};
  }

  armWatchdog();
  el.style.willChange = 'opacity, transform';
  obs.observe(el);
  return () => {
    el.style.willChange = '';
    obs.unobserve(el);
  };
}
