/* ==========================================================================
   RouteFallback — skeleton shown while a page chunk is still downloading.

   Mirrors the real page rhythm (hero + cards) so the layout does not jump.

   It is deliberately reluctant to appear:
     • if the chunk is already in memory (prefetched on hover or idle), the
       page resolves synchronously and the skeleton never mounts at all
     • otherwise the delay before showing is derived from the connection,
       not a fixed guess — ~60 ms on 2G where the wait is certain, ~220 ms on
       4G where the content usually wins the race

   Each block carries a --sk-i index; the stylesheet turns that into a small
   animation delay so the shimmer sweeps down the page instead of every block
   pulsing in unison.
   ========================================================================== */
import { useLocation } from 'react-router-dom';
import useLoadingGate from '../hooks/useLoadingGate';
import { isWarm } from '../routes';

export default function RouteFallback() {
  const { pathname } = useLocation();

  /* A prefetched chunk needs no indicator — showing one would be a flash. */
  const state = useLoadingGate(true, { skip: isWarm(pathname) });

  if (state === 'hidden') return <div className="route-skeleton__hold" aria-hidden="true" />;

  return (
    <div className="route-skeleton" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">در حال بارگذاری…</span>
      <div className="container">
        <div className="sk sk--overline" style={{ '--sk-i': 0 }} />
        <div className="sk sk--title" style={{ '--sk-i': 1 }} />
        <div className="sk sk--text" style={{ '--sk-i': 2 }} />
        <div className="sk sk--text sk--short" style={{ '--sk-i': 3 }} />
        <div className="route-skeleton__grid">
          <div className="sk sk--card" style={{ '--sk-i': 4 }} />
          <div className="sk sk--card" style={{ '--sk-i': 5 }} />
          <div className="sk sk--card" style={{ '--sk-i': 6 }} />
        </div>
      </div>
    </div>
  );
}
