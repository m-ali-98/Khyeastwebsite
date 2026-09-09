/* ==========================================================================
   Shared scroll-reveal observer.
   --------------------------------------------------------------------------
   Reveal used to be a framer-motion component, which meant one JS animation
   loop and one IntersectionObserver per element — 63 of them on the longer
   pages. This replaces all of that with a single document-wide observer that
   does nothing but toggle a class, handing the actual animation to CSS.

   That matters for smoothness, not just cost: a CSS transition on opacity and
   transform runs on the compositor, so it keeps a steady 60fps even while the
   main thread is busy parsing a chunk or hydrating a page. A JS-driven tween
   has to share the main thread with all of that.
   ========================================================================== */

let observer = null;

/* Every .reveal starts at opacity 0, so a broken observer would leave the
   page blank. Arm a one-shot watchdog the first time we observe anything: if
   something is still hidden inside the viewport well after load, give up on
   the effect and show everything. */
let watchdog = false;
function armWatchdog() {
  if (watchdog || typeof window === 'undefined') return;
  watchdog = true;
  window.setTimeout(() => {
    const stuck = document.querySelector('.reveal:not(.is-in)');
    if (!stuck) return;
    const box = stuck.getBoundingClientRect();
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
           it forever keeps a layer alive per element, which is exactly how you
           run a device out of GPU memory on a long page. Release it as soon as
           the transition finishes. */
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

  /* No observer support: show it immediately rather than leaving it stuck at
     opacity 0. */
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
