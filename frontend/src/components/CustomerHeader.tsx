// frontend/src/components/CustomerHeader.tsx
// Top of every customer-app page: optional back arrow, page title, optional extra button, language switch.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import LangToggle from './LangToggle';

export default function CustomerHeader({
  title,
  subtitle,
  backTo,
  backLabel,
  action,
}: {
  title: string;
  subtitle?: string;
  backTo?: string;
  backLabel?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-4 flex items-center gap-1">
      {backTo && (
        <Link
          to={backTo}
          aria-label={backLabel}
          className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-gray-100"
        >
          <Icon name="back" size={24} />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-bold leading-tight text-ink">{title}</h1>
        {subtitle && <p className="text-base text-gray-600">{subtitle}</p>}
      </div>
      {action}
      <LangToggle />
    </header>
  );
}
