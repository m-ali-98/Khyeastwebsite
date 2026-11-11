import { Link } from 'react-router-dom';
import { Icons, Reveal, hl } from './ui';
import { useContent } from '../content/ContentContext';
import { imgProps, SIZES } from '../lib/img';

/* These cards use Reveal rather than framer's whileInView: the shared
   observer already watches the viewport for every other section on the page,
   and a grid of cards is exactly where one observer plus one JS animation
   loop per item cost the most. */
export function ProductCard({ product, index = 0 }) {
  const { brands, t } = useContent();
  const brand = brands.find((b) => b.id === product.brand);
  return (
    <Reveal as="article" className="card product-card" y={40} delay={(index % 4) * 0.1}>
      <Link to={`/products/${product.slug}`} className="product-card__media" aria-label={product.title}>
        {/* Declare a square presentation slot so the browser reserves stable
            card space before each differently proportioned packshot loads;
            object-fit: contain keeps the complete product visible. */}
        <img {...imgProps(product.image, SIZES.card)} alt={product.title} width={720} height={720} loading="lazy" />
        <span className="product-card__brand">{brand?.fa}</span>
      </Link>
      <div className="product-card__body">
        {/* h2, not h3: these cards sit directly under the page h1 on
            /products, and skipping a level breaks screen-reader outlines. */}
        <h2>
          <Link to={`/products/${product.slug}`}>{product.title}</Link>
        </h2>
        <span className="product-card__meta">
          {product.weight} · {product.pack}
        </span>
        <div className="product-card__foot">
          <Link className="link-arrow" to={`/products/${product.slug}`}>
            {t('product.view')}
            <Icons.arrow size={17} />
          </Link>
        </div>
      </div>
    </Reveal>
  );
}

export function PostCard({ post, index = 0 }) {
  const { t } = useContent();
  return (
    <Reveal as="article" className="card post-card" y={40} delay={(index % 3) * 0.12}>
      <Link to={`/blog/${post.slug}`} className="post-card__media" aria-label={post.title}>
        <img {...imgProps(post.image, SIZES.card)} alt={post.title} loading="lazy" />
        <time className="post-card__date" dateTime={post.publishedAt || undefined}>{post.date}</time>
      </Link>
      <div className="post-card__body">
        <span className="post-card__category">{post.category}</span>
        <h2>
          <Link to={`/blog/${post.slug}`}>{post.title}</Link>
        </h2>
        <p>{post.excerpt}</p>
        <div className="post-card__foot">
          <Link className="link-arrow" to={`/blog/${post.slug}`}>
            {t('blog.readMore')}
            <Icons.arrow size={17} />
          </Link>
        </div>
      </div>
    </Reveal>
  );
}

/* The whole card is the link. Someone browsing the brand section and clicking
   a brand means "show me those" — the products page already filters on
   ?brand=, so this just hands it the id. Link, not a div with an onClick: it
   has to be middle-clickable, focusable and announced as a link. */
export function BrandCard({ brand, index = 0 }) {
  const { t } = useContent();
  return (
    <Reveal
      as={Link}
      to={`/products?brand=${encodeURIComponent(brand.id)}`}
      className="card brand-card"
      y={36}
      delay={index * 0.1}
      aria-label={`${brand.fa} — ${t('home.brands.cardLink')}`}
    >
      <div className="brand-card__img">
        <img {...imgProps(brand.image, SIZES.card)} alt={brand.fa} loading="lazy" />
      </div>
      <h2>{brand.fa}</h2>
      <p>{[brand.en, brand.tagline].filter(Boolean).join(' · ')}</p>
      <span className="brand-card__cta">
        {t('home.brands.cardLink')}
        <Icons.arrow size={15} />
      </span>
    </Reveal>
  );
}
