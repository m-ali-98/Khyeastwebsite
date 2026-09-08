import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Icons, Reveal, PageHero, faNum } from '../components/ui';
import { useContent } from '../content/ContentContext';
import { useShop, orderTokenSave } from '../shop/ShopContext';

const PHONE_RE = /^(\+98|0098|0)?9\d{9}$/;

export default function ShopCheckout() {
  const { t } = useContent();
  const { rows, subtotal, shipping, total, money, clear, paymentProvider } = useShop();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', phone: '', city: '', address: '', postal: '', note: '' });
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const online = paymentProvider !== 'offline';

  const submit = async (e) => {
    e.preventDefault();
    setNote(null);
    if (!form.name.trim() || !form.phone.trim() || !form.city.trim() || form.address.trim().length < 10)
      return setNote({ kind: 'err', msg: t('shop.checkout.errFields') });
    if (!PHONE_RE.test(form.phone.replace(/[\s-]/g, '')))
      return setNote({ kind: 'err', msg: t('shop.checkout.errPhone') });
    if (!rows.length) return navigate('/shop');

    setBusy(true);
    try {
      const res = await fetch('/api/shop-public/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: rows.map((r) => ({ slug: r.product.slug, qty: r.qty })),
          customer: {
            name: form.name.trim(),
            phone: form.phone.trim(),
            city: form.city.trim(),
            address: form.address.trim(),
            postal: form.postal.trim(),
            note: form.note.trim(),
          },
        }),
      });
      if (!res.ok) {
        const msg = res.status === 409 ? t('shop.checkout.errStock') : res.status === 400 ? t('shop.checkout.errFields') : t('shop.checkout.errServer');
        throw Object.assign(new Error(msg), { handled: true });
      }
      const data = await res.json();
      orderTokenSave(data.order.code, data.order.token);
      clear();
      if (data.payment?.payUrl) {
        window.location.assign(data.payment.payUrl);
        return;
      }
      navigate(`/shop/order/${data.order.code}?new=1`);
    } catch (err) {
      setNote({ kind: 'err', msg: err.handled ? err.message : t('shop.checkout.errServer') });
      setBusy(false);
    }
  };

  if (!rows.length && !busy) {
    return (
      <section className="section">
        <div className="container">
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
        </div>
      </section>
    );
  }

  return (
    <>
      <PageHero title={t('shop.checkout.title')} sub={t('shop.checkout.sub')} />

      <section className="section">
        <div className="container">
          <div className="checkout-grid">
            <Reveal>
              <form className="checkout-form" onSubmit={submit}>
                <h2>
                  <Icons.pin size={19} />
                  اطلاعات گیرنده
                </h2>
                <div className="checkout-form__grid">
                  <label>
                    {t('shop.checkout.name')} *
                    <input value={form.name} onChange={set('name')} maxLength={200} />
                  </label>
                  <label>
                    {t('shop.checkout.phone')} *
                    <input value={form.phone} onChange={set('phone')} dir="ltr" placeholder="09xxxxxxxxx" maxLength={20} />
                  </label>
                  <label>
                    {t('shop.checkout.city')} *
                    <input value={form.city} onChange={set('city')} maxLength={100} />
                  </label>
                  <label>
                    {t('shop.checkout.postal')}
                    <input value={form.postal} onChange={set('postal')} dir="ltr" maxLength={20} />
                  </label>
                  <label className="full">
                    {t('shop.checkout.address')} *
                    <textarea value={form.address} onChange={set('address')} maxLength={600} />
                  </label>
                  <label className="full">
                    {t('shop.checkout.note')}
                    <textarea value={form.note} onChange={set('note')} maxLength={1000} />
                  </label>
                </div>
                <AnimatePresence>
                  {note && (
                    <motion.div className={`note ${note.kind}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                      {note.msg}
                    </motion.div>
                  )}
                </AnimatePresence>
                <motion.button className="btn btn--primary" type="submit" disabled={busy} whileTap={{ scale: 0.97 }} style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}>
                  {busy ? '…' : online ? t('shop.checkout.submitPay') : t('shop.checkout.submit')}
                  {!busy && <Icons.shield size={18} />}
                </motion.button>
                {online && (
                  <p className="pay-note">
                    <Icons.check size={16} />
                    {t('shop.checkout.payNote')}
                  </p>
                )}
              </form>
            </Reveal>

            <Reveal delay={0.12} x={-24}>
              <div className="cart-summary">
                <h3>{t('shop.checkout.items')}</h3>
                <div className="checkout-items">
                  {rows.map((r) => (
                    <div className="mini-item" key={r.product.slug}>
                      <span>
                        {r.product.title} × {faNum(r.qty)}
                      </span>
                      <span>{money(r.sum)}</span>
                    </div>
                  ))}
                </div>
                <div className="cart-summary__row" style={{ marginTop: 10 }}>
                  <span>{t('shop.cart.subtotal')}</span>
                  <b>{money(subtotal)}</b>
                </div>
                <div className="cart-summary__row">
                  <span>{t('shop.cart.shipping')}</span>
                  {shipping === 0 ? <span className="free">{t('shop.cart.free')}</span> : <b>{money(shipping)}</b>}
                </div>
                <div className="cart-summary__row total">
                  <span>{t('shop.cart.total')}</span>
                  <b>{money(total)}</b>
                </div>
                <Link to="/shop/cart" className="btn btn--ghost" style={{ justifyContent: 'center' }}>
                  {t('shop.cart.title')}
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>
    </>
  );
}
