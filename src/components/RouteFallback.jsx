/* A single textless transition screen for every page navigation. Route chunks
   are no longer prefetched, and this screen is also forced for already-loaded
   chunks so browser/module caching never suppresses navigation feedback. */
import { useLocale } from '../i18n/LocaleContext';
import Logo from './Logo';

const COPY = {
  fa: { page: 'در حال بارگذاری صفحه', admin: 'در حال بارگذاری پنل مدیریت' },
  en: { page: 'Loading page', admin: 'Loading admin workspace' },
  ar: { page: 'جارٍ تحميل الصفحة', admin: 'جارٍ تحميل لوحة الإدارة' },
};

export default function RouteFallback({ mode = 'public' }) {
  const { locale } = useLocale();
  const copy = COPY[locale] || COPY.fa;
  const admin = mode === 'admin';

  return (
    <div
      className={`navigation-loader${admin ? ' navigation-loader--admin' : ''}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy="true"
    >
      <span className="sr-only">{admin ? copy.admin : copy.page}</span>
      <div className="navigation-loader__stage" aria-hidden="true">
        <span className="navigation-loader__halo" />
        <span className="navigation-loader__orbit">
          <i />
          <i />
        </span>
        <span className="navigation-loader__mark">
          <Logo size={68} className="navigation-loader__logo" />
        </span>
      </div>
    </div>
  );
}
