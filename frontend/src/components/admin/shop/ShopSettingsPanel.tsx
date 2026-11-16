// frontend/src/components/admin/shop/ShopSettingsPanel.tsx — shop settings + the one supplier (founder edits; cofounder views).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchShopSettings,
  paiseToInput,
  toPaise,
  updateShopSettings,
  updateShopSupplier,
} from '../../../api/shopAdmin';
import { ApiError } from '../../../api/client';

const errText = (e: unknown) => {
  if (e instanceof ApiError && e.fieldErrors) {
    const first = Object.values(e.fieldErrors).flat().find(Boolean);
    if (first) return first;
  }
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.';
};

type SettingsData = Awaited<ReturnType<typeof fetchShopSettings>>;

export default function ShopSettingsPanel({ readOnly }: { readOnly: boolean }) {
  const q = useQuery({ queryKey: ['shopSettings'], queryFn: fetchShopSettings });
  const [saved, setSaved] = useState<string | null>(null);
  if (q.isLoading) return <p role="status" className="text-gray-600">Loading...</p>;
  if (q.isError || !q.data) return <p role="alert" className="text-red-600">Couldn't load shop settings.</p>;
  return <SettingsForms key={q.data.settings.updatedAt} data={q.data} readOnly={readOnly} saved={saved} setSaved={setSaved} />;
}

function SettingsForms({
  data,
  readOnly,
  saved,
  setSaved,
}: {
  data: SettingsData;
  readOnly: boolean;
  saved: string | null;
  setSaved: (m: string | null) => void;
}) {
  const qc = useQueryClient();
  const d = data.settings;
  const [s, setS] = useState({
    cutoff: d.sameDayCutoff ?? '',
    codMax: paiseToInput(d.codMaxOrderPaise),
    maxOpen: String(d.maxOpenCodOrdersPerCustomer),
    phone: d.founderContactPhone,
    after: String(d.placedReminderAfterMinutes),
    repeat: String(d.placedReminderRepeatMinutes),
  });
  const [sup, setSup] = useState({
    name: data.supplier?.name ?? '',
    phone: data.supplier?.phone ?? '',
    notes: data.supplier?.notes ?? '',
  });
  const [local, setLocal] = useState<string | null>(null);

  const onSaved = (msg: string) => async (next: SettingsData) => {
    setSaved(msg);
    qc.setQueryData(['shopSettings'], next);
  };
  const saveSettings = useMutation({
    mutationFn: () =>
      updateShopSettings({
        sameDayCutoff: s.cutoff || null,
        codMaxOrderPaise: toPaise(s.codMax)!,
        maxOpenCodOrdersPerCustomer: Number(s.maxOpen),
        founderContactPhone: s.phone.trim(),
        placedReminderAfterMinutes: Number(s.after),
        placedReminderRepeatMinutes: Number(s.repeat),
      }),
    onSuccess: onSaved('Shop settings saved.'),
  });
  const saveSupplier = useMutation({
    mutationFn: () => updateShopSupplier({ name: sup.name.trim(), phone: sup.phone.trim(), notes: sup.notes.trim() }),
    onSuccess: onSaved('Supplier saved.'),
  });

  const dis = readOnly;
  return (
    <div className="grid gap-4">
      {saved && <p role="status" className="text-sm font-semibold text-green-800">{saved}</p>}
      <form
        className="card grid gap-3"
        aria-label="Shop settings"
        onSubmit={(e) => {
          e.preventDefault();
          setLocal(null);
          setSaved(null);
          if (toPaise(s.codMax) === null) return setLocal('Enter the COD limit in rupees.');
          if (![s.maxOpen, s.after, s.repeat].every((v) => /^\d+$/.test(v))) return setLocal('Use whole numbers.');
          saveSettings.mutate();
        }}
      >
        <h3 className="text-base font-semibold">Shop settings</h3>
        <div>
          <label htmlFor="st-cutoff" className="mb-1 block text-sm font-medium">Same-day order cutoff (India time)</label>
          <input id="st-cutoff" type="time" className="field" disabled={dis} value={s.cutoff}
            onChange={(e) => setS({ ...s, cutoff: e.target.value })} />
          <p className="mt-1 text-xs text-gray-600">Leave empty to switch same-day delivery off.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="st-codmax" className="mb-1 block text-sm font-medium">Max order value for cash on delivery (₹)</label>
            <input id="st-codmax" className="field" inputMode="decimal" disabled={dis} value={s.codMax}
              onChange={(e) => setS({ ...s, codMax: e.target.value })} />
          </div>
          <div>
            <label htmlFor="st-open" className="mb-1 block text-sm font-medium">Max open orders per customer</label>
            <input id="st-open" className="field" inputMode="numeric" disabled={dis} value={s.maxOpen}
              onChange={(e) => setS({ ...s, maxOpen: e.target.value })} />
          </div>
        </div>
        <div>
          <label htmlFor="st-phone" className="mb-1 block text-sm font-medium">Your contact number (shown to customers on their order)</label>
          <input id="st-phone" className="field" inputMode="tel" disabled={dis} value={s.phone}
            onChange={(e) => setS({ ...s, phone: e.target.value })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="st-after" className="mb-1 block text-sm font-medium">First reminder for a new order after (minutes)</label>
            <input id="st-after" className="field" inputMode="numeric" disabled={dis} value={s.after}
              onChange={(e) => setS({ ...s, after: e.target.value })} />
          </div>
          <div>
            <label htmlFor="st-repeat" className="mb-1 block text-sm font-medium">Then repeat every (minutes)</label>
            <input id="st-repeat" className="field" inputMode="numeric" disabled={dis} value={s.repeat}
              onChange={(e) => setS({ ...s, repeat: e.target.value })} />
          </div>
        </div>
        {(local || saveSettings.isError) && (
          <p role="alert" className="text-sm text-red-700">{local ?? errText(saveSettings.error)}</p>
        )}
        {!readOnly && (
          <button type="submit" className="btn-primary min-h-12" disabled={saveSettings.isPending}>
            {saveSettings.isPending ? 'Saving...' : 'Save settings'}
          </button>
        )}
      </form>

      <form
        className="card grid gap-3"
        aria-label="Supplier"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(null);
          saveSupplier.mutate();
        }}
      >
        <h3 className="text-base font-semibold">Supplier</h3>
        <p className="text-xs text-gray-600">Phase 1 has one supplier. Order messages to them never include customer details.</p>
        <div>
          <label htmlFor="sp-name" className="mb-1 block text-sm font-medium">Shop name</label>
          <input id="sp-name" className="field" maxLength={120} disabled={dis} value={sup.name}
            onChange={(e) => setSup({ ...sup, name: e.target.value })} />
        </div>
        <div>
          <label htmlFor="sp-phone" className="mb-1 block text-sm font-medium">WhatsApp / phone</label>
          <input id="sp-phone" className="field" inputMode="tel" disabled={dis} value={sup.phone}
            onChange={(e) => setSup({ ...sup, phone: e.target.value })} />
        </div>
        <div>
          <label htmlFor="sp-notes" className="mb-1 block text-sm font-medium">Notes (address, timings)</label>
          <textarea id="sp-notes" className="field min-h-20" maxLength={1000} disabled={dis} value={sup.notes}
            onChange={(e) => setSup({ ...sup, notes: e.target.value })} />
        </div>
        {saveSupplier.isError && <p role="alert" className="text-sm text-red-700">{errText(saveSupplier.error)}</p>}
        {!readOnly && (
          <button type="submit" className="btn-primary min-h-12" disabled={saveSupplier.isPending}>
            {saveSupplier.isPending ? 'Saving...' : 'Save supplier'}
          </button>
        )}
      </form>
    </div>
  );
}
