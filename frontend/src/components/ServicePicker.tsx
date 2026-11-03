// frontend/src/components/ServicePicker.tsx
import { useEffect, useRef, useState } from 'react';
import type { PublicService } from '../api/services';

interface Props {
  salonName: string;
  services: PublicService[];
  submitting: boolean;
  message?: string;
  onSubmit: (serviceIds: string[]) => void;
}

export default function ServicePicker({ salonName, services, submitting, message, onSubmit }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) backRef.current?.focus();
  }, [confirming]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (selected.size === 0) return setConfirming(true); // make them think twice
    onSubmit(services.filter((s) => selected.has(s.id)).map((s) => s.id));
  }

  return (
    <>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <div className="text-center">
          <p className="mb-1 text-sm text-gray-600">{salonName}</p>
          <h1 className="text-xl font-semibold">Which service do you want?</h1>
          <p className="mt-1 text-sm text-gray-600">You can choose more than one.</p>
        </div>

        <fieldset className="grid gap-3">
          <legend className="sr-only">Services</legend>
          {services.map((s) => {
            const on = selected.has(s.id);
            return (
              <label
                key={s.id}
                className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-2 ${
                  on ? 'border-ink bg-brand-soft' : 'border-gray-300 bg-white'
                }`}
              >
                <input
                  type="checkbox"
                  className="h-6 w-6 shrink-0 accent-black"
                  checked={on}
                  onChange={() => toggle(s.id)}
                />
                <span className="text-lg font-medium">{s.name}</span>
              </label>
            );
          })}
        </fieldset>

        {message && (
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {message}
          </p>
        )}

        <button type="submit" className="btn-primary" disabled={submitting} aria-busy={submitting}>
          {submitting ? 'Getting your token...' : 'Submit'}
        </button>
      </form>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onKeyDown={(e) => e.key === 'Escape' && setConfirming(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="skip-title"
            aria-describedby="skip-desc"
            className="w-full max-w-sm rounded-2xl border-2 border-ink bg-white p-5"
          >
            <h2 id="skip-title" className="text-lg font-semibold">No service chosen</h2>
            <p id="skip-desc" className="mt-1 text-gray-700">You can choose any service if you want.</p>
            <div className="mt-4 grid gap-3">
              <button ref={backRef} type="button" className="btn-primary" onClick={() => setConfirming(false)}>
                Back
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setConfirming(false);
                  onSubmit([]);
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}