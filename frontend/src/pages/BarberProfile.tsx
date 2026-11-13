// frontend/src/pages/BarberProfile.tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import BackLink from '../components/BackLink';
import OwnerRatingCard from '../components/OwnerRatingCard';
import {
  fetchBarberSalonProfile,
  updateBarberSalonProfile,
  type BarberSalonProfile,
  type SalonProfileUpdate,
} from '../api/barber';

const PROFILE_KEY = ['barberSalonProfile'];

const legendClass = 'mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500';

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
    <form onSubmit={submit} className="card grid gap-5" noValidate>
      <fieldset>
        <legend className={legendClass}>Contact</legend>
        <div className="grid gap-3 sm:grid-cols-2">
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
          <div className="sm:col-span-2">
            <label htmlFor="salon-address" className="mb-1 block text-sm font-medium">Address</label>
            <input id="salon-address" className="field" value={address} maxLength={200}
              onChange={(e) => { setAddress(e.target.value); touch(); }} />
          </div>
        </div>
      </fieldset>

      <fieldset className="border-t border-gray-200 pt-5">
        <legend className={legendClass}>Hours and timing</legend>
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
          <div className="col-span-2">
            <label htmlFor="salon-minutes" className="mb-1 block text-sm font-medium">
              Average time per customer (minutes)
            </label>
            <input id="salon-minutes" className="field" inputMode="numeric" value={minutes}
              onChange={(e) => { setMinutes(e.target.value.replace(/\D/g, '').slice(0, 3)); touch(); }} />
            <p className="mt-1 text-sm text-gray-600">Customers' wait estimates are based on this.</p>
          </div>
        </div>
      </fieldset>

      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-green-800' : 'text-red-700'}`}>
          {msg.text}
        </p>
      )}
      <button type="submit" className="btn-primary sm:w-auto sm:justify-self-end sm:px-10" disabled={!dirty || save.isPending}>
        {save.isPending ? 'Saving...' : 'Save changes'}
      </button>
    </form>
  );
}

export default function BarberProfile() {
  const { data: salon, isLoading, error, refetch } = useQuery({
    queryKey: PROFILE_KEY,
    queryFn: fetchBarberSalonProfile,
    retry: false,
  });

  return (
    <PageShell title="Salon profile">
      <BackLink />
      <h1 className="mb-1 text-2xl font-bold">Salon profile</h1>
      <p className="mb-5 text-sm text-gray-600">What customers see when they scan your QR.</p>
      <OwnerRatingCard />

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
    </PageShell>
  );
}
