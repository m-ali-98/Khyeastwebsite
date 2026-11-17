import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { m as mo } from 'framer-motion';
import { Icons, Reveal, faNum } from '../components/ui';
import PagePending from '../components/PagePending';
import { useContent } from '../content/ContentContext';
import { useShop } from '../shop/ShopContext';

const FLOW = ['pending_payment', 'paid', 'shipped', 'delivered'];

export default function ShopOrder() {
  const { code } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { t } = useContent();
  const { money, paymentProvider, loadPaymentProvider } = useShop();
  const [order, setOrder] = useState(null);
  const [state, setState] = useState('loading'); // loading | unauthenticated | notfound | ok
  const [busy, setBusy] = useState(false);
  const payLock = useRef(false);
  const [payError, setPayError] = useState('');

  const pay = params.get('pay');
  const isNew = params.get('new') === '1';
  const gatewayError = params.get('gateway') === 'error';
  const loginParams = new URLSearchParams(location.search);
  loginParams.delete('token');
  const loginNext = `${location.pathname}${loginParams.size ? `?${loginParams.toString()}` : ''}`;
  const loginHref = `/shop/login?next=${encodeURIComponent(loginNext)}`;

  /* Old SMS/history links carried a bearer token. Remove it from the current
     address before any page effects can issue same-origin requests with that
     URL as their referrer; all newly generated links are token-free. */
  useLayoutEffect(() => {
    if (!params.has('token')) return;
    const clean = new URLSearchParams(location.search);
    clean.delete('token');
    const search = clean.toString();
    navigate({
      pathname: location.pathname,
      search: search ? `?${search}` : '',
      hash: location.hash,
    }, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate, params]);

  useEffect(() => {
    loadPaymentProvider();
  }, [loadPaymentProvider]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/account/orders/${encodeURIComponent(code)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (response.status === 401) return { unauthenticated: true };
        if (!response.ok) throw new Error('order not found');
        return response.json();
      })
      .then((data) => {
        if (!alive) return;
        if (data.unauthenticated) {
          setState('unauthenticated');
          return;
        }
        setOrder(data.order);
        setState('ok');
      })
      .catch(() => alive && setState('notfound'));
    return () => {
      alive = false;
    };
  }, [code]);

  const payNow = async () => {
    if (payLock.current) return;
    payLock.current = true;
    setBusy(true);
    setPayError('');
    try {
      const res = await fetch(`/api/shop-public/orders/${encodeURIComponent(code)}/pay`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.payment?.payUrl) {
        window.location.assign(data.payment.payUrl);
        return;
      }
      if (res.status === 401) {
        setPayError('');
        setState('unauthenticated');
        return;
      }
      setPayError(data.error || t('shop.checkout.errServer'));
    } catch {
      setPayError(t('shop.checkout.errServer'));
    } finally {
      payLock.current = false;
      setBusy(false);
    }
  };

  const currentIdx = order ? FLOW.indexOf(order.status) : -1;
  const cancelled = order?.status === 'cancelled';
  const orderPaid = ['paid', 'shipped', 'delivered'].includes(order?.status);

  return (
    <section className="section">
      <div className="container">
        {state === 'loading' && <PagePending label={t('shop.order.track')} />}

        {state === 'unauthenticated' && (
          <Reveal className="cart-empty">
            <span className="ico">
              <Icons.users size={40} />
            </span>
            <h2>برای مشاهده سفارش وارد حساب کاربری خود شوید.</h2>
            <Link to={loginHref} className="btn btn--primary">
              ورود به حساب
              <Icons.arrow size={17} />
            </Link>
          </Reveal>
        )}

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
            <mo.div className={`order-hero ${orderPaid ? 'is-paid' : 'is-pending'}`} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }}>
              <span className="tick">
                {orderPaid ? <Icons.check size={40} /> : <Icons.clock size={40} />}
              </span>
              <h1>
                {cancelled
                  ? t('shop.order.st.cancelled')
                  : orderPaid && isNew
                    ? t('shop.order.thanks')
                    : orderPaid
                      ? t('shop.order.track')
                      : t('shop.order.st.pending_payment')}
              </h1>
              <div>
                <span className="code">{order.code}</span>
              </div>
              <p className="keep">{t('shop.order.keep')}</p>
            </mo.div>

            {pay === 'ok' && <div className="order-banner ok">{t('shop.order.payOk')}</div>}
            {pay === 'fail' && <div className="order-banner fail">{t('shop.order.payFail')}</div>}
            {gatewayError && order.status === 'pending_payment' && (
              <div className="order-banner fail" role="alert">
                درگاه پرداخت آماده نیست یا پاسخ نمی‌دهد؛ سفارش ثبت شده اما پرداخت نشده است. می‌توانید پس از بررسی تنظیمات، دوباره تلاش کنید.
              </div>
            )}
            {payError && <div className="order-banner fail" role="alert">{payError}</div>}
            {!pay && !gatewayError && order.status === 'pending_payment' && paymentProvider && paymentProvider !== 'offline' && (
              <div className="order-banner fail">{t('shop.order.awaitPay')}</div>
            )}
            {order.status === 'pending_payment' && paymentProvider === 'offline' && (
              <div className="order-banner fail" role="status">پرداخت آنلاین برای این سفارش در دسترس نیست. با پشتیبانی تماس بگیرید.</div>
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
                  <mo.div
                    key={s}
                    className={`step ${i < currentIdx ? 'done' : ''} ${i === currentIdx ? 'current' : ''}`}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + i * 0.12, duration: 0.45 }}
                  >
                    <span className="dot">
                      {i < currentIdx ? <Icons.check size={19} /> : i === 0 ? <Icons.clock size={18} /> : i === 1 ? <Icons.payment size={18} /> : i === 2 ? <Icons.shipping size={18} /> : <Icons.check size={18} />}
                    </span>
                    <small>{t(`shop.order.st.${s}`)}</small>
                  </mo.div>
                ))
              )}
            </div>

            <div className="order-grid section-break">
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
                    <span style={{ color: 'var(--crimson-ink)', fontWeight: 900, fontSize: 16.5 }}>{money(order.total)}</span>
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
                </div>
              </Reveal>
            </div>

            <div className="order-actions">
              {order.status === 'pending_payment' && paymentProvider !== 'offline' && (
                <mo.button className="btn btn--primary" onClick={payNow} disabled={busy} whileTap={{ scale: 0.97 }}>
                  <Icons.shield size={18} />
                  {busy ? '…' : t('shop.order.payNow')}
                </mo.button>
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
