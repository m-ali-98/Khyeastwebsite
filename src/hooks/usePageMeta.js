import { useEffect } from 'react';

/* ==========================================================================
   Per-page <title> and description for detail pages.

   App.jsx handles the static routes from a lookup table, but product and blog
   pages only know their title after the content has resolved, so they set it
   themselves. Without this every product shared the generic site title, which
   is what search engines index and show in results.

   Passing a falsy title is a no-op, so a page can call the hook before it
   knows whether its entity exists.
   ========================================================================== */
export function usePageMeta(title, description) {
  useEffect(() => {
    if (!title) return undefined;

    const previousTitle = document.title;
    document.title = title;

    let metaEl = null;
    let previousDesc = null;
    if (description) {
      metaEl = document.head.querySelector('meta[name="description"]');
      if (metaEl) {
        previousDesc = metaEl.getAttribute('content');
        metaEl.setAttribute('content', description);
      }
    }

    /* Restore on unmount so navigating away cannot leave a stale product name
       in the tab while the next page is still loading. */
    return () => {
      document.title = previousTitle;
      if (metaEl && previousDesc !== null) metaEl.setAttribute('content', previousDesc);
    };
  }, [title, description]);
}

export default usePageMeta;
