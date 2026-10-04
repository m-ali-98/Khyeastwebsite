import { Link } from 'react-router-dom';
import { m as mo } from 'framer-motion';
import { Icons } from '../components/ui';
import { useContent } from '../content/ContentContext';

export default function NotFound() {
  const { t } = useContent();
  return (
    <section className="nf">
      <div>
        <mo.h1
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          ۴۰۴
        </mo.h1>
        <mo.h2 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          {t('nf.title')}
        </mo.h2>
        <mo.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          {t('nf.text')}
        </mo.p>
        <mo.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Link to="/" className="btn btn--primary">
            {t('nf.btn')}
            <Icons.arrow size={18} />
          </Link>
        </mo.div>
      </div>
    </section>
  );
}
