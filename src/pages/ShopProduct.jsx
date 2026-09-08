import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Icons, Reveal, faNum, hl } from '../components/ui';
import { useContent } from '../content/ContentContext';
import { sanitizeHtml } from '../content/sanitize';
import { useShop } from '../shop/ShopContext';
import { ShopCard, QtyStepper } from '../shop/parts';

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
      if (!res.ok) throw new Error('fail');
      const data = await res.json();
      setNote({ kind: 'ok', msg: data.pending ? t('shop.comments.pending') : t('shop.comments.ok') });
      setName('');
      setText('');
      onDone?.(data);
    } catch {
      setNote({ kind: 'err', msg: t('shop.checkout.errServer') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.form
      className="comment-form"
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.55 }}
      onSubmit={submit}
    >
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
          <motion.div
            className={`note ${note.kind}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {note.msg}
          </motion.div>
        )}
      </AnimatePresence>
      <button className="btn btn--primary" disabled={busy} type="submit">
        <Icons.send size={17} />
        {t('shop.comments.submit')}
      </button>
    </motion.form>
  );
}

function Comments({ product }) {
  const { t } = useContent();
  const { comments, reloadComments, display } = useShop();
  const list = useMemo(
    () => comments.filter((c) => c.slug === product.slug).sort((a, b) => (a.at < b.at ? 1 : -1)),
    [comments, product.slug]
  );
  const open = display.commentsEnabled !== false && !product.commentsLocked;

  return (
    <section className="section" style={{ paddingTop: 0 }}>
      <div className="container">
        <Reveal className="shop-comments__head">
          <h2>{hl(t('shop.comments.title'))}</h2>
          <p>{t('shop.comments.sub')}</p>
        </Reveal>

        <div className="shop-comments__grid">
          <div>
            {list.length === 0 && <p style={{ color: 'var(--muted)', fontWeight: 700 }}>{t('shop.comments.empty')}</p>}
            <AnimatePresence>
              {list.map((c, i) => (
                <motion.div
                  className="comment"
                  key={c.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.45, delay: Math.min(i * 0.06, 0.3) }}
                >
                  <div className="comment__head">
                    <span className="avatar">{c.name.trim().charAt(0)}</span>
                    <div>
                      <b>{c.name}</b>
                      <br />
                      <small>{new Date(c.at).toLocaleDateString('fa-IR')}</small>
                    </div>
                    {!c.approved && <span className="awaiting">{t('shop.comments.awaiting')}</span>}
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
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <div>
            {open ? (
              <CommentForm slug={product.slug} onDone={() => reloadComments()} />
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
      <section className="section">
        <div className="container">
          <Reveal className="cart-empty">
            <span className="ico">
              <Icons.box size={40} />
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
      <section className="section">
        <div className="container">
          <Reveal className="sp-detail">
            <div className="sp-gallery">
              <motion.img
                key={p.slug}
                src={p.image}
                alt={p.title}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>

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
                  <motion.button
                    className={`btn ${added ? 'btn--outline' : 'btn--primary'}`}
                    disabled={out}
                    onClick={() => add(p.slug, qty) && setAdded(true)}
                    whileTap={{ scale: 0.96 }}
                  >
                    {added ? (
                      t('shop.detail.added')
                    ) : (
                      <>
                        <Icons.box size={18} />
                        {t('shop.detail.addToCart')}
                      </>
                    )}
                  </motion.button>
                </div>
                {catalogItem && (
                  <p style={{ marginTop: 16 }}>
                    <Link to={`/products/${catalogItem.slug}`} className="btn btn--ghost btn--sm">
                      <Icons.doc size={16} />
                      {t('shop.detail.catalog')}
                    </Link>
                  </p>
                )}
              </div>

              <div className="shop-trust" style={{ marginBottom: 0 }}>
                {[
                  { icon: 'shield', key: 'shop.trust.guarantee' },
                  { icon: 'box', key: 'shop.trust.shipping' },
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

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="sp-info">
            {p.specs?.length > 0 && (
              <Reveal className="sp-specs" x={-24}>
                <h3>
                  <Icons.gear size={18} />
                  {t('shop.detail.specs')}
                </h3>
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
              <h3>{t('shop.detail.desc')}</h3>
              <div className="post-body" dangerouslySetInnerHTML={{ __html: safeDesc }} />
            </Reveal>
          </div>
        </div>
      </section>

      {relatedFinal.length > 0 && (
        <section className="section" style={{ paddingTop: 0 }}>
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
