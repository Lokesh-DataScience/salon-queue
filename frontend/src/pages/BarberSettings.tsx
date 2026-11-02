// frontend/src/pages/BarberSettings.tsx
import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell';

const rows = [
  { to: '/barber/qr', title: 'Salon QR code', hint: 'View and print the poster customers scan' },
  { to: '/barber/offers', title: 'Offers', hint: 'Rewards for customers who scan your QR' },
];

export default function BarberSettings() {
  return (
    <PageShell title="Settings">
      <h1 className="mb-4 text-xl font-semibold">Settings</h1>
      <ul className="grid gap-3">
        {rows.map((r) => (
          <li key={r.to}>
            <Link to={r.to} className="card flex min-h-14 items-center justify-between gap-3 hover:bg-brand-soft">
              <span>
                <span className="block text-base font-semibold">{r.title}</span>
                <span className="block text-sm text-gray-600">{r.hint}</span>
              </span>
              <span aria-hidden="true" className="text-xl">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}