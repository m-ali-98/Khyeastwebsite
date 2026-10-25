import { AlertTriangle, X } from 'lucide-react';
import { faNum } from '../components/ui';
import { useContent } from '../content/ContentContext';
import { useShop } from './ShopContext';

function ChangeMessage({ change, t }) {
  const title = <strong><bdi>{change.title || change.slug}</bdi></strong>;

  if (change.kind === 'adjusted') {
    if (change.reason === 'stock_reduced') {
      return (
        <>
          {t('shop.cart.availabilityQtyStart')} {title}{' '}
          {t('shop.cart.availabilityQtyFrom')} {faNum(change.from)}{' '}
          {t('shop.cart.availabilityQtyTo')} {faNum(change.to)}{' '}
          {t('shop.cart.availabilityQtyEnd')}
        </>
      );
    }
    return <>{t('shop.cart.availabilityQtyFixed')} {title} {faNum(change.to)}.</>;
  }

  const messageKey = {
    missing: 'shop.cart.availabilityMissing',
    inactive: 'shop.cart.availabilityInactive',
    out_of_stock: 'shop.cart.availabilityOut',
    invalid_quantity: 'shop.cart.availabilityInvalidQty',
    unavailable: 'shop.cart.availabilityUnavailable',
  }[change.reason] || 'shop.cart.availabilityUnavailable';

  return <>{title} {t(messageKey)}</>;
}

export default function CartAvailabilityNotice() {
  const { t } = useContent();
  const { availabilityNotice, dismissAvailabilityNotice } = useShop();
  const changes = availabilityNotice?.changes || [];
  if (!changes.length) return null;

  return (
    <section
      className="cart-availability"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="cart-availability-notice"
    >
      <AlertTriangle aria-hidden="true" />
      <div className="cart-availability__body">
        <strong className="cart-availability__title">{t('shop.cart.availabilityTitle')}</strong>
        <p>{t('shop.cart.availabilityIntro')}</p>
        <ul>
          {changes.map((change, index) => (
            <li key={`${change.slug}-${change.kind}-${index}`}>
              <ChangeMessage change={change} t={t} />
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        className="cart-availability__dismiss"
        onClick={dismissAvailabilityNotice}
        aria-label={t('shop.cart.availabilityDismiss')}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </section>
  );
}
