import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Icons, Reveal, faNum } from '../components/ui';
import { useContent } from '../content/ContentContext';
import { useShop, orderTokenGet } from '../shop/ShopContext';

const FLOW = ['pending_payment', 'paid', 'shipped', 'delivered'];

export default function ShopOrder() {
  const { code } = useParams();
  const [params] = useSearchParams();
  const { t } = useContent();
  const { money, paymentProvider } = useShop();
  const [order, setOrder] = useState(null);
  const [state, setState] = useState('loading'); // loading | notfound | ok
  const [busy, setBusy] = useState(false);

  const token = orderTokenGet(code) || params.get('token') || '';
  const pay = params.get('pay');
  const isNew = params.get('new') === '1';

  useEffect(() => {
    let alive = true;
    fetch(`/api/shop-public/orders/${encodeURIComponent(code)}?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!alive) return;
        setOrder(d.order);
        setState('ok');
      })
      .catch(() => alive && setState('notfound'));
    return () => {
      alive = false;
    };
  }, [code, token]);

  const payNow = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/shop-public/orders/${encodeURIComponent(code)}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (res.ok && data.payment?.payUrl) {
        window.location.assign(data.payment.payUrl);
        return;
      }
      setBusy(false);
    } catch {
      setBusy(false);
    }
  };

  const currentIdx = order ? FLOW.indexOf(order.status) : -1;
  const cancelled = order?.status === 'cancelled';

  return (
    <section className="section">
      <div className="container">
        {state === 'loading' && <p style={{ textAlign: 'center', color: 'var(--muted)', fontWeight: 700, padding: 60 }}>…</p>}

        {state === 'notfound' && (
          <Reveal className="cart-empty">
            <span className="ico">
              <Icons.doc size={40} />
            </span>
            <h2>{t('shop.order.notFound')}</h2>
            <Link to="/shop" className="btn btn--primary">
              {t('shop.cart.emptyBtn')}
              <Icons.arrow size={17} />
            </Link>
          </Reveal>
        )}

        {state === 'ok' && order && (
          <>
            <motion.div className="order-hero" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }}>
              <span className="tick">
                <Icons.check size={40} />
              </span>
              <h1>{isNew ? t('shop.order.thanks') : t('shop.order.track')}</h1>
              <div>
                <span className="code">{order.code}</span>
              </div>
              <p className="keep">{t('shop.order.keep')}</p>
            </motion.div>

            {pay === 'ok' && <div className="order-banner ok">{t('shop.order.payOk')}</div>}
            {pay === 'fail' && <div className="order-banner fail">{t('shop.order.payFail')}</div>}
            {!pay && order.status === 'pending_payment' && paymentProvider !== 'offline' && (
              <div className="order-banner fail">{t('shop.order.awaitPay')}</div>
            )}

            <div className={`order-timeline ${cancelled ? 'cancelled' : ''}`}>
              {cancelled ? (
                <div className="step cancel current" style={{ width: '100%' }}>
                  <span className="dot">
                    <Icons.clock size={19} />
                  </span>
                  <small>{t('shop.order.st.cancelled')}</small>
                </div>
              ) : (
                FLOW.map((s, i) => (
                  <motion.div
                    key={s}
                    className={`step ${i < currentIdx ? 'done' : ''} ${i === currentIdx ? 'current' : ''}`}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + i * 0.12, duration: 0.45 }}
                  >
                    <span className="dot">
                      {i < currentIdx ? <Icons.check size={19} /> : i === 0 ? <Icons.clock size={18} /> : i === 1 ? <Icons.discount size={18} /> : i === 2 ? <Icons.send size={18} /> : <Icons.star size={18} />}
                    </span>
                    <small>{t(`shop.order.st.${s}`)}</small>
                  </motion.div>
                ))
              )}
            </div>

            <div className="order-grid" style={{ marginTop: 40 }}>
              <Reveal>
                <div className="order-card">
                  <h3>
                    <Icons.pack size={18} />
                    {t('shop.order.items')}
                  </h3>
                  {order.items.map((it) => (
                    <div className="order-card__row" key={it.slug}>
                      <span>
                        {it.title} × {faNum(it.qty)}
                      </span>
                      <span>{money(it.sum)}</span>
                    </div>
                  ))}
                  <div className="order-card__row">
                    <span>{t('shop.cart.subtotal')}</span>
                    <span>{money(order.subtotal)}</span>
                  </div>
                  <div className="order-card__row">
                    <span>{t('shop.cart.shipping')}</span>
                    <span>{order.shipping === 0 ? t('shop.cart.free') : money(order.shipping)}</span>
                  </div>
                  <div className="order-card__row" style={{ fontSize: 15 }}>
                    <span style={{ color: 'var(--ink)', fontWeight: 900 }}>{t('shop.cart.total')}</span>
                    <span style={{ color: 'var(--crimson)', fontWeight: 900, fontSize: 16.5 }}>{money(order.total)}</span>
                  </div>
                </div>
              </Reveal>

              <Reveal delay={0.12} x={-24}>
                <div className="order-card">
                  <h3>
                    <Icons.pin size={18} />
                    {t('shop.order.receiver')}
                  </h3>
                  <div className="order-card__row">
                    <span>{t('shop.order.receiver')}</span>
                    <span>{order.customer.name}</span>
                  </div>
                  <div className="order-card__row">
                    <span>{t('shop.order.phone')}</span>
                    <span dir="ltr">{order.customer.phone}</span>
                  </div>
                  <div className="order-card__row">
                    <span>{t('shop.order.address')}</span>
                    <span>
                      {order.customer.city} — {order.customer.address}
                    </span>
                  </div>
                  {order.customer.postal && (
                    <div className="order-card__row">
                      <span>{t('shop.checkout.postal')}</span>
                      <span dir="ltr">{order.customer.postal}</span>
                    </div>
                  )}
                  {order.customer.note && (
                    <div className="order-card__row">
                      <span>{t('shop.order.note')}</span>
                      <span>{order.customer.note}</span>
                    </div>
                  )}
                  <div className="order-card__row">
                    <span>{t('shop.order.date')}</span>
                    <span>{new Date(order.at).toLocaleString('fa-IR')}</span>
                  </div>
                  {order.payRef && (
                    <div className="order-card__row">
                      <span>{t('shop.order.ref')}</span>
                      <span dir="ltr">{String(order.payRef).slice(0, 24)}</span>
                    </div>
                  )}
                </div>
              </Reveal>
            </div>

            <div className="order-actions">
              {order.status === 'pending_payment' && paymentProvider !== 'offline' && (
                <motion.button className="btn btn--primary" onClick={payNow} disabled={busy} whileTap={{ scale: 0.97 }}>
                  <Icons.shield size={18} />
                  {busy ? '…' : t('shop.order.payNow')}
                </motion.button>
              )}
              <Link to="/shop" className="btn btn--outline">
                {t('shop.order.back')}
                <Icons.arrow size={17} />
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
