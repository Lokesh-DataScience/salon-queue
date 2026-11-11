// frontend/src/components/BackLink.tsx
// The "back" button at the top of Settings sub-pages.
import { Link } from 'react-router-dom';

type Props = { to?: string; children?: string };

export default function BackLink({ to = '/barber/settings', children = 'Back to settings' }: Props) {
  return (
    <Link
      to={to}
      className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-ink bg-white px-4 text-sm font-semibold text-ink shadow-[0_2px_0_0_var(--color-ink)] hover:bg-brand-soft active:translate-y-[2px] active:shadow-none print:hidden"
    >
      <span aria-hidden="true">←</span>
      {children}
    </Link>
  );
}
