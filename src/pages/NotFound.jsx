import { Link } from 'react-router-dom';
import { m as mo } from 'framer-motion';
import { Icons } from '../components/ui';
import { useContent } from '../content/ContentContext';

export default function NotFound() {
  const { t } = useContent();

  return (
    <section className="nf" aria-labelledby="not-found-title">
      <div className="container nf__inner">
        <mo.article
          className="nf__card"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="nf__visual" aria-hidden="true">
            <span className="nf__code">{t('nf.code')}</span>
            <span className="nf__mark"><Icons.wheat size={28} /></span>
          </div>

          <div className="nf__content">
            <span className="nf__eyebrow">{t('nf.eyebrow')}</span>
            <h1 id="not-found-title">{t('nf.title')}</h1>
            <p>{t('nf.text')}</p>
            <div className="nf__actions">
              <Link to="/" className="btn btn--primary">
                {t('nf.btn')}
                <Icons.arrow size={18} />
              </Link>
              <Link to="/products" className="btn btn--outline">
                {t('nf.products')}
              </Link>
            </div>
          </div>
        </mo.article>
      </div>
    </section>
  );
}
