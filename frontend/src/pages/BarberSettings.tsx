// frontend/src/pages/BarberSettings.tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import { Link, useNavigate } from 'react-router-dom';
import {
  fetchBarberSalonProfile,
  updateBarberSalonProfile,
  logoutBarber,
  type BarberSalonProfile,
  type SalonProfileUpdate,
} from '../api/barber';

const PROFILE_KEY = ['barberSalonProfile'];

const rows = [
  { to: '/barber/qr', title: 'Salon QR code', hint: 'View and print the poster customers scan' },
  { to: '/barber/offers', title: 'Offers', hint: 'Rewards for customers who scan your QR' },
];

function ProfileForm({ salon }: { salon: BarberSalonProfile }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(salon.name);
  const [phone, setPhone] = useState(salon.phone);
  const [address, setAddress] = useState(salon.address);
  const [opening, setOpening] = useState(salon.openingTime);
  const [closing, setClosing] = useState(salon.closingTime);
  const [minutes, setMinutes] = useState(String(salon.averageServiceMinutes));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Only what actually changed is sent.
  const changes: SalonProfileUpdate = {};
  if (name.trim() !== salon.name) changes.name = name.trim();
  if (phone.trim() !== salon.phone) changes.phone = phone.trim();
  if (address.trim() !== salon.address) changes.address = address.trim();
  if (opening !== salon.openingTime) changes.openingTime = opening;
  if (closing !== salon.closingTime) changes.closingTime = closing;
  if (minutes !== '' && Number(minutes) !== salon.averageServiceMinutes) {
    changes.averageServiceMinutes = Number(minutes);
  }
  const dirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: (c: SalonProfileUpdate) => updateBarberSalonProfile(c),
    onSuccess: (updated) => {
      // The server may have tidied values (e.g. phone), so show what it stored.
      setName(updated.name);
      setPhone(updated.phone);
      setAddress(updated.address);
      setOpening(updated.openingTime);
      setClosing(updated.closingTime);
      setMinutes(String(updated.averageServiceMinutes));
      queryClient.setQueryData(PROFILE_KEY, updated);
      queryClient.invalidateQueries({ queryKey: ['barberSalon'] }); // QR poster shows the name
      setMsg({ ok: true, text: 'Saved.' });
    },
    onError: (e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' }),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const m = Number(minutes);
    if (!Number.isInteger(m) || m < 1 || m > 240) {
      return setMsg({ ok: false, text: 'Average service time must be 1 to 240 minutes.' });
    }
    if (!opening || !closing || opening >= closing) {
      return setMsg({ ok: false, text: 'Closing time must be after opening time.' });
    }
    if (dirty) save.mutate(changes);
  }

  const touch = () => setMsg(null);

  return (
    <form onSubmit={submit} className="card grid gap-3" noValidate>
      <div>
        <label htmlFor="salon-name" className="mb-1 block text-sm font-medium">Salon name</label>
        <input id="salon-name" className="field" value={name} maxLength={80}
          onChange={(e) => { setName(e.target.value); touch(); }} />
      </div>
      <div>
        <label htmlFor="salon-phone" className="mb-1 block text-sm font-medium">Phone number</label>
        <input id="salon-phone" className="field" inputMode="tel" autoComplete="tel" value={phone}
          onChange={(e) => { setPhone(e.target.value); touch(); }} />
      </div>
      <div>
        <label htmlFor="salon-address" className="mb-1 block text-sm font-medium">Address</label>
        <input id="salon-address" className="field" value={address} maxLength={200}
          onChange={(e) => { setAddress(e.target.value); touch(); }} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="salon-opening" className="mb-1 block text-sm font-medium">Opens at</label>
          <input id="salon-opening" type="time" className="field" value={opening}
            onChange={(e) => { setOpening(e.target.value); touch(); }} />
        </div>
        <div>
          <label htmlFor="salon-closing" className="mb-1 block text-sm font-medium">Closes at</label>
          <input id="salon-closing" type="time" className="field" value={closing}
            onChange={(e) => { setClosing(e.target.value); touch(); }} />
        </div>
      </div>
      <div>
        <label htmlFor="salon-minutes" className="mb-1 block text-sm font-medium">
          Average time per customer (minutes)
        </label>
        <input id="salon-minutes" className="field" inputMode="numeric" value={minutes}
          onChange={(e) => { setMinutes(e.target.value.replace(/\D/g, '').slice(0, 3)); touch(); }} />
        <p className="mt-1 text-sm text-gray-600">Customers' wait estimates are based on this.</p>
      </div>

      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-green-800' : 'text-red-700'}`}>
          {msg.text}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={!dirty || save.isPending}>
        {save.isPending ? 'Saving...' : 'Save changes'}
      </button>
    </form>
  );
}
function LogoutButton() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);
    await logoutBarber().catch(() => {});
    navigate('/barber/login', { replace: true });
    queryClient.clear();
  }

  return (
    <button type="button" className="btn-secondary" onClick={handleLogout} disabled={busy} aria-busy={busy}>
      {busy ? 'Logging out...' : 'Log out'}
    </button>
  );
}
export default function BarberSettings() {
  const { data: salon, isLoading, error, refetch } = useQuery({
    queryKey: PROFILE_KEY,
    queryFn: fetchBarberSalonProfile,
    retry: false,
  });

  return (
    <PageShell title="Settings">
      <h1 className="mb-4 text-xl font-semibold">Settings</h1>

      <section aria-labelledby="profile-heading" className="mb-6">
        <h2 id="profile-heading" className="mb-2 text-sm font-semibold text-gray-700">Salon profile</h2>
        {isLoading ? (
          <p role="status" className="text-gray-600">Loading your salon...</p>
        ) : error || !salon ? (
          <div className="card text-center">
            <p role="alert" className="mb-3 text-red-700">Could not load your salon details.</p>
            <button type="button" className="btn-secondary" onClick={() => refetch()}>Try again</button>
          </div>
        ) : (
          <ProfileForm salon={salon} />
        )}
      </section>

      <section aria-labelledby="more-heading">
        <h2 id="more-heading" className="mb-2 text-sm font-semibold text-gray-700">More</h2>
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
      </section>
            <section aria-labelledby="account-heading" className="mt-6">
        <h2 id="account-heading" className="mb-2 text-sm font-semibold text-gray-700">Account</h2>
        <LogoutButton />
      </section>
    </PageShell>
  );
}