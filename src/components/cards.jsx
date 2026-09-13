import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Icons, hl } from './ui';
import { useContent } from '../content/ContentContext';
import { productImgProps } from '../lib/productImage';

/* Mirrors .products-grid in global.scss: 4 columns, then 3 below 1200px,
   2 below 760px and 1 below 520px, inside a 1240px container with 24px
   padding and a 24px gutter (16px on the narrow breakpoints). If the grid
   changes, this has to change with it — a wrong `sizes` makes the browser
   download the wrong file, which is worse than having no srcset at all. */
const PRODUCT_CARD_SIZES =
  '(max-width: 520px) calc(100vw - 48px), (max-width: 760px) calc((100vw - 64px) / 2), (max-width: 1200px) calc((100vw - 96px) / 3), 280px';

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
        <img
          {...productImgProps(product.image, PRODUCT_CARD_SIZES)}
          alt={product.title}
          /* The intrinsic ratio is declared so the browser reserves the square
             box before the file arrives — without it the grid jumps as each
             photo loads. The first row is above the fold on most screens, so
             only later cards are lazy. */
          width={720}
          height={720}
          loading={index < 4 ? 'eager' : 'lazy'}
          decoding="async"
        />
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
        <img src={post.image} alt={post.title} loading="lazy" />
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
        <img src={brand.image} alt={brand.fa} loading="lazy" />
      </div>
      <h3>{brand.fa}</h3>
      <p>
        {brand.en} · {brand.tagline}
      </p>
    </motion.div>
  );
}
