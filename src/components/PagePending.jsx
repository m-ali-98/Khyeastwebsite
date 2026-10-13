/* Delayed, connection-aware feedback for page data that resolves after its
   route chunk (account session, order lookup, checkout profile). Fast API
   responses render directly; slower ones inherit the same visual language as
   route loading instead of falling back to a lone ellipsis. */
import useLoadingGate from '../hooks/useLoadingGate';
import { useLocale } from '../i18n/LocaleContext';

const COPY = {
  fa: { title: 'در حال دریافت اطلاعات', hint: 'آخرین اطلاعات این بخش در حال آماده‌سازی است' },
  en: { title: 'Loading the latest details', hint: 'This section will be ready shortly' },
  ar: { title: 'جارٍ تحميل أحدث المعلومات', hint: 'سيصبح هذا القسم جاهزًا بعد لحظات' },
};

function Line({ className = '', index = 0 }) {
  return <span className={`sk ${className}`} style={{ '--sk-i': index }} />;
}

export default function PagePending({ label = '' }) {
  const { locale } = useLocale();
  const copy = COPY[locale] || COPY.fa;
  const state = useLoadingGate(true);

  if (state === 'hidden') return <div className="page-pending__hold" aria-hidden="true" />;

  return (
    <div className="page-pending" role="status" aria-live="polite" aria-busy="true">
      <div className="route-loader__status">
        <span className="route-loader__pulse" aria-hidden="true"><i /></span>
        <span>
          <strong>{copy.title}</strong>
          <small>{label ? `${label} — ${copy.hint}` : copy.hint}</small>
        </span>
      </div>
      <div className="page-pending__blueprint" aria-hidden="true">
        <div className="page-pending__panel">
          <Line className="sk--overline" index={0} />
          <Line className="sk--heading" index={1} />
          <Line className="sk--input" index={2} />
          <Line className="sk--input" index={3} />
          <Line className="sk--action" index={4} />
        </div>
        <aside className="page-pending__aside">
          <Line className="sk--heading" index={2} />
          <Line className="sk--text" index={3} />
          <Line className="sk--text sk--short" index={4} />
          <span className="route-loader__summary-rule" />
          <Line className="sk--line" index={5} />
          <Line className="sk--line sk--line-short" index={6} />
        </aside>
      </div>
    </div>
  );
}
