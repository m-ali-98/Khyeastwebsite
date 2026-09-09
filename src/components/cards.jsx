import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Icons, hl } from './ui';
import { useContent } from '../content/ContentContext';
import SmartImage from './SmartImage';

export function ProductCard({ product, index = 0 }) {
  const { brands, t } = useContent();
  const brand = brands.find((b) => b.id === product.brand);
  return (
    <motion.article
      className="card product-card"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.65, delay: (index % 4) * 0.1, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link to={`/products/${product.slug}`} className="product-card__media" aria-label={product.title}>
        <SmartImage src={product.image} alt={product.title} />
        <span className="product-card__brand">{brand?.fa}</span>
      </Link>
      <div className="product-card__body">
        <h3>
          <Link to={`/products/${product.slug}`}>{product.title}</Link>
        </h3>
        <span className="product-card__meta">
          {product.weight} · {product.pack}
        </span>
        <div className="product-card__foot">
          <Link className="link-arrow" to={`/products/${product.slug}`}>
            {t('product.view')}
            <Icons.arrow size={17} className="arr" />
          </Link>
        </div>
      </div>
    </motion.article>
  );
}

export function PostCard({ post, index = 0 }) {
  const { t } = useContent();
  return (
    <motion.article
      className="card post-card"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.65, delay: (index % 3) * 0.12, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link to={`/blog/${post.slug}`} className="post-card__media" aria-label={post.title}>
        <SmartImage src={post.image} alt={post.title} />
        <span className="post-card__date">{post.date}</span>
      </Link>
      <div className="post-card__body">
        <h3>
          <Link to={`/blog/${post.slug}`}>{post.title}</Link>
        </h3>
        <p>{post.excerpt}</p>
        <div className="post-card__foot">
          <Link className="link-arrow" to={`/blog/${post.slug}`}>
            {t('blog.readMore')}
            <Icons.arrow size={17} className="arr" />
          </Link>
        </div>
      </div>
    </motion.article>
  );
}

export function BrandCard({ brand, index = 0 }) {
  return (
    <motion.div
      className="card brand-card"
      initial={{ opacity: 0, y: 36 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay: index * 0.1, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="brand-card__img">
        <SmartImage src={brand.image} alt={brand.fa} />
      </div>
      <h3>{brand.fa}</h3>
      <p>
        {brand.en} · {brand.tagline}
      </p>
    </motion.div>
  );
}
