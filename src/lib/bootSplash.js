/* The first-paint splash lives in index.html so it can appear before the React
   bundle. React calls this only after the active route has actually committed;
   direct visits to a lazy page therefore keep meaningful feedback on screen
   instead of revealing an empty shell while its chunk is still downloading. */
export function dismissBootSplash() {
  if (typeof document === 'undefined') return;
  const splash = document.getElementById('boot-splash');
  if (!splash || splash.dataset.dismissStarted === '1') return;
  splash.dataset.dismissStarted = '1';

  /* Give the committed route one real paint before moving the cover away. This
     is readiness-driven, not a minimum-duration loading timer. */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        splash.remove();
        return;
      }

      let safety = 0;
      const remove = () => {
        window.clearTimeout(safety);
        splash.removeEventListener('transitionend', onEnd);
        splash.remove();
      };
      const onEnd = (event) => {
        if (event.target === splash && event.propertyName === 'transform') remove();
      };

      splash.addEventListener('transitionend', onEnd);
      splash.classList.add('is-done');

      /* A disabled/unsupported transition must never leave an invisible fixed
         layer over the app. Normal removal happens via transitionend. */
      safety = window.setTimeout(remove, 700);
    });
  });
}
