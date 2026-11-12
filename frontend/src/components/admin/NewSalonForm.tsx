// frontend/src/components/admin/NewSalonForm.tsx
// Founder → Salons → Add a salon. Same checks as the public sign-up (done on the server).
// You choose the owner's first password and give it to them; they can change it in Settings.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createAdminSalon, type AdminCreateSalonInput } from '../../api/admin';
import { ApiError } from '../../api/client';

type Form = Record<
  'salonName' | 'ownerName' | 'email' | 'password' | 'phone' | 'address' | 'latitude' | 'longitude' |
  'openingTime' | 'closingTime' | 'averageServiceMinutes',
  string
>;

const EMPTY: Form = {
  salonName: '', ownerName: '', email: '', password: '', phone: '', address: '',
  latitude: '', longitude: '', openingTime: '09:00', closingTime: '21:00', averageServiceMinutes: '15',
};

const FIELDS: { key: keyof Form; label: string; type?: string; hint?: string; inputMode?: 'decimal' | 'numeric' | 'email' | 'tel' }[] = [
  { key: 'salonName', label: 'Salon name' },
  { key: 'ownerName', label: "Owner's name" },
  { key: 'email', label: "Owner's email (their login)", type: 'email', inputMode: 'email' },
  { key: 'password', label: 'First password for the owner', hint: 'At least 8 characters. Give it to the owner.' },
  { key: 'phone', label: 'Salon phone', type: 'tel', inputMode: 'tel' },
  { key: 'address', label: 'Address' },
  { key: 'latitude', label: 'Latitude', inputMode: 'decimal', hint: 'In Google Maps, long-press the shop and copy the two numbers.' },
  { key: 'longitude', label: 'Longitude', inputMode: 'decimal' },
  { key: 'openingTime', label: 'Opens at', type: 'time' },
  { key: 'closingTime', label: 'Closes at', type: 'time' },
  { key: 'averageServiceMinutes', label: 'Average minutes per customer', inputMode: 'numeric' },
];

export default function NewSalonForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (salonId: string) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(EMPTY);
  const [isInternal, setIsInternal] = useState(false);

  const m = useMutation({
    mutationFn: (input: AdminCreateSalonInput) => createAdminSalon(input),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['adminSalons'] });
      onCreated(r.salonId);
    },
  });

  const fieldErrors = m.error instanceof ApiError ? m.error.fieldErrors ?? {} : {};
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form
      className="grid gap-3"
      aria-label="Add a salon"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate({
          ...form,
          email: form.email.trim(),
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
          averageServiceMinutes: Number(form.averageServiceMinutes),
          isInternal,
        });
      }}
    >
      <button type="button" onClick={onCancel} className="justify-self-start text-sm font-semibold text-gray-700 underline">
        ‹ All salons
      </button>
      <h3 className="text-xl font-bold">Add a salon</h3>

      {FIELDS.map((f) => {
        const err = fieldErrors[f.key]?.[0];
        const id = `ns-${f.key}`;
        return (
          <div key={f.key}>
            <label htmlFor={id} className="mb-1 block text-sm font-medium">{f.label}</label>
            <input
              id={id}
              className="field"
              type={f.type ?? 'text'}
              inputMode={f.inputMode}
              required
              autoComplete="off"
              value={form[f.key]}
              onChange={set(f.key)}
              aria-invalid={err ? true : undefined}
              aria-describedby={err ? `${id}-err` : f.hint ? `${id}-hint` : undefined}
            />
            {f.hint && !err && <p id={`${id}-hint`} className="mt-1 text-xs text-gray-600">{f.hint}</p>}
            {err && <p id={`${id}-err`} className="mt-1 text-sm text-red-700">{err}</p>}
          </div>
        );
      })}

      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" className="h-5 w-5" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
        <span>Internal salon (demo or test — left out of the numbers)</span>
      </label>

      {m.isError && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {m.error instanceof Error ? m.error.message : 'Could not add the salon.'}
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={m.isPending}>
        {m.isPending ? 'Adding...' : 'Add salon'}
      </button>
    </form>
  );
}
