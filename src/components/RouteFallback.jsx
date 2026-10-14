/* ==========================================================================
   RouteFallback — adaptive feedback while a route chunk is downloading.

   Fast, prefetched routes never show it. A cold route waits for the
   connection-aware gate before presenting a shape that resembles the page
   being opened (collection, detail, task, or editorial). That avoids both the
   80 ms "loader flash" on fibre and the dead-screen feeling on a slow link.

   The moving sheen lives on a translated pseudo-element. It never animates a
   large block's background-position, so route feedback stays compositor-only.
   ========================================================================== */
import { useLocation } from 'react-router-dom';
import useLoadingGate from '../hooks/useLoadingGate';
import { useLocale } from '../i18n/LocaleContext';
import { isWarm } from '../routes';
import Logo from './Logo';

const COPY = {
  fa: { page: 'در حال آماده‌سازی صفحه', admin: 'در حال آماده‌سازی پنل مدیریت' },
  en: { page: 'Preparing the page', admin: 'Preparing the admin workspace' },
  ar: { page: 'جارٍ تجهيز الصفحة', admin: 'جارٍ تجهيز لوحة الإدارة' },
};

function routeLoadingShape(pathname = '/') {
  if (/^\/(products|blog)\/[^/]+$/.test(pathname)) return 'detail';
  if (/^\/shop\/[^/]+$/.test(pathname) && !/^\/shop\/(cart|checkout|login|account|order)(\/|$)/.test(pathname)) {
    return 'detail';
  }
  if (pathname === '/contact' || /^\/shop\/(cart|checkout|login|account|order)(\/|$)/.test(pathname)) return 'task';
  if (/^\/(products|blog|shop)$/.test(pathname)) return 'collection';
  return 'editorial';
}

function Sk({ className = '', index = 0 }) {
  return <span className={`sk ${className}`} style={{ '--sk-i': index }} />;
}

function LoadingSignal({ label }) {
  return (
    <>
      <span className="sr-only">{label}</span>
      <div className="route-loader__signal" aria-hidden="true">
        <span />
        <i />
      </div>
    </>
  );
}

function CollectionSkeleton() {
  return (
    <div className="route-loader__blueprint" aria-hidden="true">
      <div className="route-loader__intro">
        <Sk className="sk--overline" index={0} />
        <Sk className="sk--title" index={1} />
        <Sk className="sk--text" index={2} />
        <Sk className="sk--text sk--short" index={3} />
      </div>
      <div className="route-loader__cards">
        {[0, 1, 2].map((item) => (
          <div className="route-loader__card" key={item}>
            <Sk className="sk--media" index={4 + item} />
            <div className="route-loader__card-copy">
              <Sk className="sk--eyebrow" index={7 + item} />
              <Sk className="sk--line" index={8 + item} />
              <Sk className="sk--line sk--line-short" index={9 + item} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="route-loader__detail" aria-hidden="true">
      <Sk className="sk--detail-media" index={0} />
      <div className="route-loader__detail-copy">
        <Sk className="sk--overline" index={1} />
        <Sk className="sk--title" index={2} />
        <Sk className="sk--text" index={3} />
        <Sk className="sk--text" index={4} />
        <Sk className="sk--text sk--short" index={5} />
        <div className="route-loader__chips">
          <Sk className="sk--chip" index={6} />
          <Sk className="sk--chip" index={7} />
          <Sk className="sk--chip" index={8} />
        </div>
        <Sk className="sk--action" index={9} />
      </div>
    </div>
  );
}

function TaskSkeleton() {
  return (
    <div className="route-loader__task" aria-hidden="true">
      <div className="route-loader__panel">
        <Sk className="sk--overline" index={0} />
        <Sk className="sk--heading" index={1} />
        {[0, 1, 2].map((item) => (
          <div className="route-loader__field" key={item}>
            <Sk className="sk--label" index={2 + item * 2} />
            <Sk className="sk--input" index={3 + item * 2} />
          </div>
        ))}
        <Sk className="sk--action" index={8} />
      </div>
      <aside className="route-loader__summary">
        <Sk className="sk--heading" index={2} />
        <Sk className="sk--text" index={3} />
        <Sk className="sk--text sk--short" index={4} />
        <span className="route-loader__summary-rule" />
        <Sk className="sk--line" index={5} />
        <Sk className="sk--line sk--line-short" index={6} />
      </aside>
    </div>
  );
}

function EditorialSkeleton() {
  return (
    <div className="route-loader__blueprint" aria-hidden="true">
      <div className="route-loader__intro">
        <Sk className="sk--overline" index={0} />
        <Sk className="sk--title" index={1} />
        <Sk className="sk--text" index={2} />
        <Sk className="sk--text sk--short" index={3} />
      </div>
      <div className="route-loader__feature">
        <Sk className="sk--feature-media" index={4} />
        <div className="route-loader__feature-copy">
          <Sk className="sk--heading" index={5} />
          <Sk className="sk--text" index={6} />
          <Sk className="sk--text" index={7} />
          <Sk className="sk--text sk--short" index={8} />
        </div>
      </div>
    </div>
  );
}

export default function RouteFallback({ mode = 'public' }) {
  const { pathname } = useLocation();
  const { locale } = useLocale();
  const admin = mode === 'admin';
  const copy = COPY[locale] || COPY.fa;

  /* /admin is intentionally absent from the public prefetch map, so it must
     not inherit isWarm()'s "unknown route means no public chunk" shortcut. */
  const state = useLoadingGate(true, { skip: !admin && isWarm(pathname) });

  if (state === 'hidden') {
    return <div className={`route-fallback route-loader__hold${admin ? ' route-loader__hold--admin' : ''}`} aria-hidden="true" />;
  }

  if (admin) {
    return (
      <div className="route-fallback route-loader route-loader--admin" role="status" aria-live="polite" aria-busy="true">
        <div className="route-loader__rail" aria-hidden="true"><span /></div>
        <div className="route-loader__admin-card">
          <div className="route-loader__admin-mark" aria-hidden="true">
            <Logo size={48} className="route-loader__logo" />
          </div>
          <LoadingSignal label={copy.admin} />
          <div className="route-loader__admin-lines" aria-hidden="true">
            <Sk className="sk--line" index={0} />
            <Sk className="sk--line sk--line-short" index={1} />
          </div>
        </div>
      </div>
    );
  }

  const shape = routeLoadingShape(pathname);
  return (
    <section className={`route-fallback route-loader route-loader--${shape}`} role="status" aria-live="polite" aria-busy="true">
      <div className="route-loader__rail" aria-hidden="true"><span /></div>
      <div className="container">
        <LoadingSignal label={copy.page} />
        {shape === 'collection' && <CollectionSkeleton />}
        {shape === 'detail' && <DetailSkeleton />}
        {shape === 'task' && <TaskSkeleton />}
        {shape === 'editorial' && <EditorialSkeleton />}
      </div>
    </section>
  );
}
