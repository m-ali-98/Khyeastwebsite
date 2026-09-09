/* ==========================================================================
   RouteFallback — skeleton shown while a page chunk is still downloading.
   Mirrors the real page rhythm (hero + cards) so the layout does not jump,
   and appears only after 180 ms to avoid a flash on fast connections.
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
        <div className="sk sk--overline" />
        <div className="sk sk--title" />
        <div className="sk sk--text" />
        <div className="sk sk--text sk--short" />
        <div className="route-skeleton__grid">
          <div className="sk sk--card" />
          <div className="sk sk--card" />
          <div className="sk sk--card" />
        </div>
      </div>
    </div>
  );
}
