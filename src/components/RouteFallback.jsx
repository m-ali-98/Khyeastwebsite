/* ==========================================================================
   RouteFallback — skeleton shown while a page chunk is still downloading.
   Mirrors the real page rhythm (hero + cards) so the layout does not jump,
   and appears only after 180 ms to avoid a flash on fast connections.

   Each block carries a --sk-i index; the stylesheet turns that into a small
   animation delay so the shimmer sweeps down the page instead of every block
   pulsing in unison.
   ========================================================================== */
import { useEffect, useState } from 'react';

export default function RouteFallback() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShow(true), 180);
    return () => clearTimeout(id);
  }, []);

  if (!show) return <div className="route-skeleton__hold" aria-hidden="true" />;

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
