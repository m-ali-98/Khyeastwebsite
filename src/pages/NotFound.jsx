import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Icons } from '../components/ui';
import { COMPANY } from '../data/site';

export default function NotFound() {
  return (
    <section className="nf">
      <div>
        <motion.h1
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          ۴۰۴
        </motion.h1>
        <motion.h2 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          این صفحه در تنور ما پخته نشد!
        </motion.h2>
        <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          نشانی موردنظر شما یافت نشد؛ اما داستان ما همچنان {COMPANY.slogan} است.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Link to="/" className="btn btn--primary">
            بازگشت به صفحه اصلی
            <Icons.arrow size={18} />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
