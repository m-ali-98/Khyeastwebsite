import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, m as mo } from 'framer-motion';
import { Icons, Reveal, PageHero, faNum, faId } from '../components/ui';
import { useContent } from '../content/ContentContext';
import { useShop, orderTokenSave } from '../shop/ShopContext';
import { useAccount } from '../shop/AccountContext';

export default function ShopCheckout() {
  const { t } = useContent();
  const { rows, subtotal, shipping, total, money, clear, paymentProvider } = useShop();
  const account = useAccount();
  const navigate = useNavigate();

  /* Checkout is for account holders now. Send them to sign in, remembering
     where they were, and carry the cart with them — it lives in
     localStorage, so it survives the round trip. */
  useEffect(() => {
    if (account.status === 'out') navigate('/shop/login?next=/shop/checkout', { replace: true });
  }, [account.status, navigate]);

  /* The default address, preselected: most people have one and should not
     have to choose anything. */
  const [addressId, setAddressId] = useState('');
  useEffect(() => {
    if (!addressId && account.addresses.length) setAddressId((account.addresses.find((a) => a.isDefault) || account.addresses[0]).id);
  }, [account.addresses, addressId]);

  const [form, setForm] = useState({ name: '', phone: '', city: '', address: '', postal: '', note: '' });
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const online = paymentProvider !== 'offline';

  const submit = async (e) => {
    e.preventDefault();
    setNote(null);
    if (!addressId) return setNote({ kind: 'err', msg: t('shop.checkout.needAddress') });
    if (!rows.length) return navigate('/shop');

    setBusy(true);
    try {
      const res = await fetch('/api/shop-public/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: rows.map((r) => ({ slug: r.product.slug, qty: r.qty })),
          /* The address is identified, not re-typed: the server copies the
             saved one into the order, so what ships is what the customer
             saw and chose. */
          customer: { addressId, note: form.note.trim() },
        }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        if (res.status === 401) {
          navigate('/shop/login?next=/shop/checkout');
          return;
        }
        const msg =
          res.status === 409
            ? t('shop.checkout.errStock')
            : res.status === 400
              ? t('shop.checkout.errFields')
              : res.status === 429
                ? t('form.errRateLimited')
                : t('shop.checkout.errServer');
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
              <Icons.cart size={40} />
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
                  {t('shop.checkout.chooseAddress')}
                </h2>

                {account.customer && (
                  <p className="checkout-who">
                    {t('shop.checkout.signedInAs')} <b>{account.customer.name}</b>{' '}
                    <span dir="ltr">{faId(account.customer.phoneLocal)}</span>
                  </p>
                )}

                {/* A radio list, not a dropdown: the full address has to be
                    readable before paying, and a <select> hides all but one
                    line of it. */}
                <div className="checkout-addr">
                  {account.addresses.map((a) => (
                    <label key={a.id} className={`checkout-addr__item ${addressId === a.id ? 'is-on' : ''}`}>
                      <input type="radio" name="addr" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
                      <span>
                        <b>{a.title}</b>
                        <small>
                          {a.province}، {a.city}، {a.address}
                          {a.plaque && `، پلاک ${faId(a.plaque)}`}
                        </small>
                        <small>
                          {a.receiver} — <span dir="ltr">{faId(a.phone.replace(/^98/, '0'))}</span>
                        </small>
                      </span>
                    </label>
                  ))}
                  <Link className="btn btn--outline btn--sm" to="/shop/account">
                    <Icons.pin size={16} />
                    {account.addresses.length ? t('shop.checkout.newAddress') : t('shop.account.addAddress')}
                  </Link>
                </div>

                <label className="field">
                  <span>{t('shop.checkout.note')}</span>
                  <textarea value={form.note} onChange={set('note')} maxLength={1000} rows={2} />
                </label>
                <AnimatePresence>
                  {note && (
                    <mo.div className={`note ${note.kind}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                      {note.msg}
                    </mo.div>
                  )}
                </AnimatePresence>
                <mo.button className="btn btn--primary" type="submit" disabled={busy} whileTap={{ scale: 0.97 }} style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}>
                  {busy ? '…' : online ? t('shop.checkout.submitPay') : t('shop.checkout.submit')}
                  {!busy && <Icons.shield size={18} />}
                </mo.button>
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
