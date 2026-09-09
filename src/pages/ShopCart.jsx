import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Icons, Reveal, PageHero, faNum } from '../components/ui';
import { useContent } from '../content/ContentContext';
import { useShop } from '../shop/ShopContext';
import { QtyStepper } from '../shop/parts';
import SmartImage from '../components/SmartImage';

export default function ShopCart() {
  const { t } = useContent();
  const { rows, setQty, remove, subtotal, shipping, total, money, display, count } = useShop();
  const navigate = useNavigate();

  const freeOver = Number(display.freeShippingOver) || 0;

  return (
    <>
      <PageHero title={t('shop.cart.title')} sub={count ? `${faNum(count)} کالا در سبد خرید شما` : t('shop.cart.empty')} />

      <section className="section">
        <div className="container">
          {rows.length === 0 ? (
            <Reveal className="cart-empty">
              <span className="ico">
                <Icons.box size={40} />
              </span>
              <h2>{t('shop.cart.empty')}</h2>
              <Link to="/shop" className="btn btn--primary">
                {t('shop.cart.emptyBtn')}
                <Icons.arrow size={17} />
              </Link>
            </Reveal>
          ) : (
            <div className="cart-layout">
              <Reveal>
                <div className="cart-table">
                  <div className="cart-table__row head">
                    <span>{t('shop.cart.headItem')}</span>
                    <span style={{ textAlign: 'center' }}>{t('shop.cart.headQty')}</span>
                    <span className="cart-table__price">{t('shop.cart.headPrice')}</span>
                    <span className="cart-table__sum">{t('shop.cart.headSum')}</span>
                    <span />
                  </div>
                  <AnimatePresence>
                    {rows.map((r) => (
                      <motion.div
                        className="cart-table__row"
                        key={r.product.slug}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, x: 40 }}
                        transition={{ duration: 0.35 }}
                      >
                        <div className="cart-table__item">
                          <SmartImage src={r.product.image} alt="" />
                          <div>
                            <b>
                              <Link to={`/shop/${r.product.slug}`}>{r.product.title}</Link>
                            </b>
                            <small>{r.product.unit}</small>
                          </div>
                        </div>
                        <div style={{ justifySelf: 'center' }}>
                          <QtyStepper
                            value={r.qty}
                            onChange={(v) => setQty(r.product.slug, v)}
                            max={Number(r.product.stock) > 0 ? Number(r.product.stock) : 999}
                            min={0}
                          />
                        </div>
                        <span className="cart-table__price">{money(r.product.price)}</span>
                        <span className="cart-table__sum">{money(r.sum)}</span>
                        <button className="cart-table__del" onClick={() => remove(r.product.slug)} aria-label={t('shop.cart.remove')}>
                          ✕
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </Reveal>

              <Reveal delay={0.12} x={-24}>
                <div className="cart-summary">
                  <h3>{t('shop.cart.summary')}</h3>
                  <div className="cart-summary__row">
                    <span>{t('shop.cart.subtotal')}</span>
                    <b>{money(subtotal)}</b>
                  </div>
                  <div className="cart-summary__row">
                    <span>{t('shop.cart.shipping')}</span>
                    {shipping === 0 ? <span className="free">{t('shop.cart.free')}</span> : <b>{money(shipping)}</b>}
                  </div>
                  {freeOver > 0 && shipping > 0 && (
                    <p className="free-note">
                      {t('shop.cart.freeNote')} ({money(freeOver)})
                    </p>
                  )}
                  <div className="cart-summary__row total">
                    <span>{t('shop.cart.total')}</span>
                    <b>{money(total)}</b>
                  </div>
                  <motion.button className="btn btn--primary" whileTap={{ scale: 0.97 }} onClick={() => navigate('/shop/checkout')}>
                    {t('shop.cart.checkout')}
                    <Icons.arrow size={18} />
                  </motion.button>
                  <Link to="/shop" className="btn btn--ghost" style={{ justifyContent: 'center' }}>
                    {t('shop.cart.emptyBtn')}
                  </Link>
                </div>
              </Reveal>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
