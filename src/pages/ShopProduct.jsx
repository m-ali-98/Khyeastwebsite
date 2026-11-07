import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, m as mo } from 'framer-motion';
import { Icons, Reveal, faNum, hl } from '../components/ui';
import { useContent } from '../content/ContentContext';
import { sanitizeHtml } from '../content/sanitize';
import { useShop } from '../shop/ShopContext';
import { ShopCard, QtyStepper } from '../shop/parts';
import ProductGallery from '../components/ProductGallery';

/* React StrictMode intentionally remounts effects in development. Share only
   in-flight page requests (never completed data) so that safety check does not
   issue two identical comment queries while production freshness is unchanged. */
const pendingCommentPages = new Map();
const fetchCommentPage = (query) => {
  const key = String(query);
  if (pendingCommentPages.has(key)) return pendingCommentPages.get(key);
  const request = fetch(`/api/shop-public/comments?${key}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`comments api ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.comments)) throw new Error('invalid comments payload');
      return payload;
    })
    .finally(() => {
      if (pendingCommentPages.get(key) === request) pendingCommentPages.delete(key);
    });
  pendingCommentPages.set(key, request);
  return request;
};

function CommentForm({ slug, onDone }) {
  const { t } = useContent();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState(null); // {kind:'ok'|'err', msg}
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !text.trim()) return setNote({ kind: 'err', msg: t('shop.comments.err') });
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/shop-public/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, name: name.trim(), text: text.trim() }),
      });
      /* Carry the status out of the try block so a rate-limited poster is told
         to wait rather than being shown a generic server error. */
      if (!res.ok) throw Object.assign(new Error('fail'), { status: res.status });
      const data = await res.json();
      setNote({ kind: 'ok', msg: data.pending ? t('shop.comments.pending') : t('shop.comments.ok') });
      setName('');
      setText('');
      onDone?.(data);
    } catch (err) {
      setNote({
        kind: 'err',
        msg: t(err?.status === 429 ? 'form.errRateLimited' : 'shop.checkout.errServer'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Reveal as="form" className="comment-form" y={26} onSubmit={submit}>
      <h3>{t('shop.comments.title')}</h3>
      <label>
        {t('shop.comments.name')}
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </label>
      <label>
        {t('shop.comments.text')}
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1500} />
      </label>
      <AnimatePresence>
        {note && (
          <mo.div
            className={`note ${note.kind}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {note.msg}
          </mo.div>
        )}
      </AnimatePresence>
      <button className="btn btn--primary" disabled={busy} type="submit">
        <Icons.send size={17} />
        {t('shop.comments.submit')}
      </button>
    </Reveal>
  );
}

function Comments({ product }) {
  const { t } = useContent();
  const { display } = useShop();
  const [list, setList] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestSequence = useRef(0);
  const open = display.commentsEnabled !== false && !product.commentsLocked;

  const loadPage = useCallback(async (cursor = '', append = false) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      const query = new URLSearchParams({ slug: product.slug, limit: '8' });
      if (cursor) query.set('cursor', cursor);
      const payload = await fetchCommentPage(query);
      if (sequence !== requestSequence.current) return;
      setList((current) => {
        if (!append) return payload.comments;
        const known = new Set(current.map((comment) => comment.id));
        return [...current, ...payload.comments.filter((comment) => !known.has(comment.id))];
      });
      setNextCursor(typeof payload.nextCursor === 'string' && payload.nextCursor ? payload.nextCursor : null);
    } catch {
      if (sequence === requestSequence.current) setLoadFailed(true);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [product.slug]);

  useEffect(() => {
    loadPage();
    return () => { requestSequence.current += 1; };
  }, [loadPage]);

  return (
    <section className="section section--soft shop-product-comments">
      <div className="container">
        <Reveal className="shop-comments__head">
          <h2>{hl(t('shop.comments.title'))}</h2>
          <p>{t('shop.comments.sub')}</p>
        </Reveal>

        <div className="shop-comments__grid">
          <div aria-live="polite">
            {loading && list.length === 0 && <p className="shop-comments__empty">{t('shop.comments.loading')}</p>}
            {loadFailed && list.length === 0 && (
              <div className="shop-comments__load-error">
                <p className="shop-comments__empty">{t('shop.comments.loadError')}</p>
                <button type="button" className="btn btn--outline btn--sm" onClick={() => loadPage()}>
                  {t('shop.comments.retry')}
                </button>
              </div>
            )}
            {!loading && !loadFailed && list.length === 0 && (
              <p className="shop-comments__empty">{t('shop.comments.empty')}</p>
            )}
            <AnimatePresence>
              {list.map((c, i) => (
                <Reveal className="comment" key={c.id} y={20} delay={Math.min(i, 8) * 0.06}>
                  <div className="comment__head">
                    <span className="avatar">{c.name.trim().charAt(0)}</span>
                    <div>
                      <b>{c.name}</b>
                      <br />
                      <small>{new Date(c.at).toLocaleDateString('fa-IR')}</small>
                    </div>
                  </div>
                  <p className="comment__text">{c.text}</p>
                  {c.reply && (
                    <div className="comment__reply">
                      <b>
                        <Icons.send size={15} />
                        {t('shop.comments.reply')}
                      </b>
                      <p>{c.reply}</p>
                    </div>
                  )}
                </Reveal>
              ))}
            </AnimatePresence>
            {loadFailed && list.length > 0 && <p className="shop-comments__empty">{t('shop.comments.loadError')}</p>}
            {nextCursor && (
              <button
                type="button"
                className="btn btn--outline btn--sm shop-comments__more"
                disabled={loading}
                onClick={() => loadPage(nextCursor, true)}
              >
                {loading ? t('shop.comments.loading') : t('shop.comments.more')}
              </button>
            )}
          </div>
          <div>
            {open ? (
              <CommentForm slug={product.slug} onDone={() => loadPage()} />
            ) : (
              <Reveal className="shop-comments__locked">
                {product.commentsLocked ? t('shop.comments.locked') : t('shop.comments.disabled')}
              </Reveal>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function ShopProduct() {
  const { slug } = useParams();
  const { t, l, brands, products: catalog } = useContent();
  const { products, display, money, add, bySlug } = useShop();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const p = bySlug(slug);
  const safeDesc = useMemo(() => (p ? sanitizeHtml(p.description || '') : ''), [p]);
  const related = useMemo(
    () => (p ? products.filter((x) => x.active && x.slug !== p.slug && (x.brand === p.brand)).slice(0, 3) : []),
    [products, p]
  );
  const relatedFinal = related.length ? related : products.filter((x) => x.active && p && x.slug !== p.slug).slice(0, 3);
  const out = p ? Number(p.stock) === 0 : true;
  const off = p && p.oldPrice && Number(p.oldPrice) > Number(p.price)
    ? Math.round((1 - Number(p.price) / Number(p.oldPrice)) * 100)
    : 0;
  const brand = p ? brands.find((b) => b.id === p.brand) : null;
  const catalogItem = p?.productSlug ? catalog.find((c) => c.slug === p.productSlug) : null;

  useEffect(() => {
    setQty(1);
    setAdded(false);
  }, [slug]);

  useEffect(() => {
    if (!added) return undefined;
    const id = setTimeout(() => setAdded(false), 2000);
    return () => clearTimeout(id);
  }, [added]);

  if (!p || !p.active) {
    return (
      <section className="section section--nav-offset shop-product-page">
        <div className="container">
          <Reveal className="cart-empty">
            <span className="ico">
              <Icons.store size={40} />
            </span>
            <h2>{t('shop.order.notFound')}</h2>
            <Link to="/shop" className="btn btn--primary">
              {t('shop.cart.emptyBtn')}
              <Icons.arrow size={17} />
            </Link>
          </Reveal>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="section section--nav-offset shop-product-page">
        <div className="container">
          <Reveal as="nav" className="breadcrumb shop-product-page__breadcrumb" aria-label={t('nav.breadcrumb.home')}>
            <Link to="/">{t('nav.breadcrumb.home')}</Link>
            <span className="sep">/</span>
            <Link to="/shop">{t('nav.shop')}</Link>
            <span className="sep">/</span>
            <span>{p.title}</span>
          </Reveal>
          <Reveal className="sp-detail">
            <ProductGallery
              images={p.images}
              primary={p.image}
              title={p.title}
              className="sp-gallery"
              sizes="(max-width: 900px) 100vw, 44vw"
              eager
            />

            <div className="sp-buy">
              {brand && <span className="sp-buy__brand">{brand.fa} · {brand.en}</span>}
              <h1>{p.title}</h1>
              <p className="sp-buy__short">{p.short}</p>

              <div className="sp-buy__box">
                <div className="sp-buy__price">
                  <span className="now">{money(p.price)}</span>
                  {off > 0 && (
                    <>
                      <span className="was">{money(p.oldPrice)}</span>
                      <span className="off">{faNum(off)}٪ {t('shop.card.off')}</span>
                    </>
                  )}
                </div>
                <div className={`sp-buy__stock ${out ? 'is-out' : ''}`}>
                  {out
                    ? t('shop.detail.stockOut')
                    : Number(p.stock) <= 10
                      ? t('shop.card.lowStock')
                      : t('shop.card.inStock')}
                </div>
                <div className="sp-buy__row">
                  <QtyStepper value={qty} onChange={(v) => setQty(Math.max(1, v))} max={Number(p.stock) > 0 ? Number(p.stock) : 999} min={1} />
                  <mo.button
                    className={`btn ${added ? 'btn--outline' : 'btn--primary'}`}
                    disabled={out}
                    onClick={() => add(p.slug, qty) && setAdded(true)}
                    whileTap={{ scale: 0.96 }}
                    aria-live="polite"
                  >
                    {added ? (
                      <>
                        <Icons.check size={18} className="confirm-icon" />
                        {t('shop.detail.added')}
                      </>
                    ) : (
                      <>
                        <Icons.cart size={18} />
                        {t('shop.detail.addToCart')}
                      </>
                    )}
                  </mo.button>
                </div>
                {catalogItem && (
                  <div className="sp-buy__catalog-link">
                    <Link to={`/products/${catalogItem.slug}`} className="btn btn--soft btn--sm">
                      <Icons.doc size={16} />
                      {t('shop.detail.catalog')}
                    </Link>
                  </div>
                )}
              </div>

              <div className="shop-trust shop-trust--inline">
                {[
                  { icon: 'shield', key: 'shop.trust.guarantee' },
                  { icon: 'shipping', key: 'shop.trust.shipping' },
                ].map((item) => {
                  const Ic = Icons[item.icon];
                  return (
                    <div className="shop-trust__item" key={item.key}>
                      <span className="ico">
                        <Ic size={20} />
                      </span>
                      <span>{t(item.key)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="section section--soft shop-product-info">
        <div className="container">
          <div className="sp-info">
            {p.specs?.length > 0 && (
              <Reveal className="sp-specs" x={-24}>
                {/* h2: the product title above is the page's h1, and an h3
                    here skips a level — screen-reader users navigating by
                    heading would be told a section is missing. */}
                <h2>
                  <Icons.gear size={18} />
                  {t('shop.detail.specs')}
                </h2>
                <table>
                  <tbody>
                    {p.specs.map(([k, v], i) => (
                      <tr key={i}>
                        <td>{k}</td>
                        <td>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Reveal>
            )}
            <Reveal className="sp-desc" x={24}>
              <h2>{t('shop.detail.desc')}</h2>
              <div className="post-body" dangerouslySetInnerHTML={{ __html: safeDesc }} />
            </Reveal>
          </div>
        </div>
      </section>

      {relatedFinal.length > 0 && (
        <section className="section shop-product-related">
          <div className="container">
            <Reveal className="shop-comments__head">
              <h2>{hl(t('shop.detail.related'))}</h2>
            </Reveal>
            <div className="shop-grid">
              {relatedFinal.map((x, i) => (
                <ShopCard key={x.slug} p={x} index={i} />
              ))}
            </div>
          </div>
        </section>
      )}

      <Comments product={p} />
    </>
  );
}
