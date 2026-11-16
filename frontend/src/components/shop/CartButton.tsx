// frontend/src/components/shop/CartButton.tsx — cart link with item count, for the shop page headers.
import { Link } from 'react-router-dom';
import Icon from '../Icon';
import { cartCount, useCart } from '../../lib/cart';
import { useT } from '../../lib/i18n';

const TEXT = {
  hi: { label: (n: number) => (n ? `कार्ट, ${n} सामान` : 'कार्ट') },
  en: { label: (n: number) => (n ? `Cart, ${n} item${n === 1 ? '' : 's'}` : 'Cart') },
};

export default function CartButton() {
  const t = useT(TEXT);
  const n = cartCount(useCart());
  return (
    <Link
      to="/c/shop/cart"
      aria-label={t.label(n)}
      className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-gray-100"
    >
      <Icon name="bag" size={24} />
      {n > 0 && (
        <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-ink px-1 text-center text-xs font-bold leading-5 text-white">
          {n > 99 ? '99+' : n}
        </span>
      )}
    </Link>
  );
}
