// frontend/src/components/ServicePicker.tsx
import { useState } from 'react';
import type { PublicService } from '../api/publicServices';
import { useT } from '../lib/i18n';

const rupees = (p: number) => `₹${p.toLocaleString('en-IN')}`;

const TEXT = {
  hi: {
    legend: 'आपको क्या करवाना है?',
    min: (m: number) => `${m} मिनट`,
    none: 'एक या ज़्यादा सेवाएँ चुनें।',
    chosen: (n: number, m: number, price: string) => `${n} ${n === 1 ? 'सेवा' : 'सेवाएँ'} · लगभग ${m} मिनट${price}`,
    noService: 'आपने कोई सेवा नहीं चुनी। इंतज़ार का अंदाज़ा सैलून के औसत समय से लगेगा।',
    noServiceLabel: 'कोई सेवा नहीं चुनी',
    continue: 'आगे बढ़ें',
    back: 'वापस',
    busy: 'टोकन ले रहे हैं...',
    get: 'मेरा टोकन लें',
    footer: 'साइन-अप की ज़रूरत नहीं। हम सूचना भेजने की अनुमति माँग सकते हैं।',
  },
  en: {
    legend: 'What would you like done?',
    min: (m: number) => `${m} min`,
    none: 'Tick one or more services.',
    chosen: (n: number, m: number, price: string) => `${n} ${n === 1 ? 'service' : 'services'} · about ${m} min${price}`,
    noService: "You haven't chosen a service. Your wait estimate will use the salon's average time per customer.",
    noServiceLabel: 'No service chosen',
    continue: 'Continue',
    back: 'Back',
    busy: 'Getting your token...',
    get: 'Get my token',
    footer: 'No sign-up needed. We may ask to send you alerts.',
  },
};

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
  const t = useT(TEXT);
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
        <legend className="mb-2 text-sm font-semibold text-gray-700">{t.legend}</legend>
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
                    {t.min(s.durationMinutes)}
                    {s.priceRupees != null && <span className="block font-semibold text-ink">{rupees(s.priceRupees)}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <p role="status" className="mt-3 text-sm text-gray-700">
        {chosen.length === 0 ? t.none : t.chosen(chosen.length, total, totalPrice != null ? ` · ${rupees(totalPrice)}` : '')}
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </p>
      )}

      {confirmNone ? (
        <div role="alertdialog" aria-label={t.noServiceLabel} className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="mb-3 text-sm text-amber-900">
            {t.noService}
          </p>
          <div className="flex gap-3">
            <button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => onJoin([])}>
              {busy ? t.busy : t.continue}
            </button>
            <button type="button" className="btn-secondary flex-1" disabled={busy} onClick={() => setConfirmNone(false)}>
              {t.back}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-primary mt-4" disabled={busy} aria-busy={busy} onClick={submit}>
          {busy ? t.busy : t.get}
        </button>
      )}
      <p className="mt-3 text-center text-xs text-gray-600">{t.footer}</p>
    </div>
  );
}