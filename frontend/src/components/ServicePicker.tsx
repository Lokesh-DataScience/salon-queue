// frontend/src/components/ServicePicker.tsx
import { useState } from 'react';
import type { PublicService } from '../api/publicServices';

export default function ServicePicker({
  services,
  busy,
  error,
  onJoin,
}: {
  services: PublicService[];
  busy: boolean;
  error?: string;
  onJoin: (serviceIds: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [confirmNone, setConfirmNone] = useState(false);

  // A service the barber removed meanwhile drops out of the selection.
  const valid = picked.filter((id) => services.some((s) => s.id === id));
  const chosen = services.filter((s) => valid.includes(s.id));
  const total = chosen.reduce((n, s) => n + s.durationMinutes, 0);
  // A total price only when every chosen service has one.
  const priced = chosen.length > 0 && chosen.every((s) => s.priceRupees != null);
  const totalPrice = priced ? chosen.reduce((n, s) => n + (s.priceRupees ?? 0), 0) : null;

  function toggle(id: string) {
    setConfirmNone(false);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  function submit() {
    if (valid.length === 0) return setConfirmNone(true);
    onJoin(valid);
  }

  return (
    <div>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-gray-700">What would you like done?</legend>
        <ul className="grid gap-2">
          {services.map((s) => {
            const on = valid.includes(s.id);
            return (
              <li key={s.id}>
                <label
                  className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 ${
                    on ? 'border-ink bg-brand-soft' : 'border-gray-300 bg-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-6 w-6 shrink-0"
                    checked={on}
                    disabled={busy}
                    onChange={() => toggle(s.id)}
                  />
                  <span className="flex-1 text-base font-semibold">{s.name}</span>
                  <span className="text-right text-sm text-gray-700">
                    {s.durationMinutes} min
                    {s.priceRupees != null && <span className="block font-semibold text-ink">₹{s.priceRupees.toLocaleString('en-IN')}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <p role="status" className="mt-3 text-sm text-gray-700">
        {chosen.length === 0
          ? 'Tick one or more services.'
          : `${chosen.length} ${chosen.length === 1 ? 'service' : 'services'} · about ${total} min${
              totalPrice != null ? ` · ₹${totalPrice.toLocaleString('en-IN')}` : ''
            }`}
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </p>
      )}

      {confirmNone ? (
        <div role="alertdialog" aria-label="No service chosen" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="mb-3 text-sm text-amber-900">
            You haven't chosen a service. Your wait estimate will use the salon's average time per customer.
          </p>
          <div className="flex gap-3">
            <button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => onJoin([])}>
              {busy ? 'Getting your token...' : 'Continue'}
            </button>
            <button type="button" className="btn-secondary flex-1" disabled={busy} onClick={() => setConfirmNone(false)}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-primary mt-4" disabled={busy} aria-busy={busy} onClick={submit}>
          {busy ? 'Getting your token...' : 'Get my token'}
        </button>
      )}
      <p className="mt-3 text-center text-xs text-gray-600">No sign-up needed. We may ask to send you alerts.</p>
    </div>
  );
}