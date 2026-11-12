// frontend/src/components/admin/SalesPanel.tsx
// Sales tab: which salons are active, which have gone quiet, where they are, and the sales notes.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSalesActivity, updateSalesInfo, type SalesArea, type SalesSalon } from '../../api/admin';

type Filter = 'all' | 'risk' | 'partners';
const fmt = (n: number) => n.toLocaleString('en-IN');
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

function lastTicketText(s: SalesSalon) {
  if (s.daysSinceLastTicket === null) return 'Never had a ticket';
  if (s.daysSinceLastTicket === 0) return 'Last ticket today';
  if (s.daysSinceLastTicket === 1) return 'Last ticket yesterday';
  return `Last ticket ${s.daysSinceLastTicket} days ago`;
}

function AreaTable({ areas }: { areas: SalesArea[] }) {
  if (areas.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-xl border-2 border-gray-200 bg-white">
      <table className="w-full text-left text-base">
        <caption className="px-3 pt-3 text-left text-sm font-semibold text-gray-700">Areas</caption>
        <thead className="bg-gray-50 text-sm text-gray-700">
          <tr>
            <th scope="col" className="px-3 py-2">Area</th>
            <th scope="col" className="px-3 py-2 text-right">Salons</th>
            <th scope="col" className="px-3 py-2 text-right">Active (7 days)</th>
            <th scope="col" className="px-3 py-2 text-right">Tickets this month</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 tabular-nums">
          {areas.map((a) => (
            <tr key={a.area}>
              <th scope="row" className="px-3 py-2 font-semibold">{a.area}</th>
              <td className="px-3 py-2 text-right">{fmt(a.salons)}</td>
              <td className="px-3 py-2 text-right">{fmt(a.activeSalons7d)}</td>
              <td className="px-3 py-2 text-right">{fmt(a.ticketsThisMonth)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotesEditor({ s, onDone }: { s: SalesSalon; onDone: () => void }) {
  const qc = useQueryClient();
  const [isPartner, setIsPartner] = useState(s.isPartner);
  const [notes, setNotes] = useState(s.notes);
  const m = useMutation({
    mutationFn: () => updateSalesInfo(s.id, { isPartner, notes }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['salesActivity'] });
      onDone();
    },
  });
  const id = `notes-${s.id}`;
  return (
    <form
      className="mt-3 grid gap-2"
      aria-label={`Sales notes for ${s.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" className="h-5 w-5" checked={isPartner} onChange={(e) => setIsPartner(e.target.checked)} />
        <span>Partner salon</span>
      </label>
      <label htmlFor={id} className="text-sm font-medium">Notes</label>
      <textarea id={id} className="field min-h-24" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {m.isError && (
        <p role="alert" className="text-sm text-red-700">
          {m.error instanceof Error ? m.error.message : 'Could not save. Please try again.'}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary min-h-11 flex-1" disabled={m.isPending}>
          {m.isPending ? 'Saving...' : 'Save'}
        </button>
        <button type="button" className="btn-secondary min-h-11 px-4" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function SalonCard({ s }: { s: SalesSalon }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-base font-semibold">{s.name}</h4>
        {s.churnRisk && (
          <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-900">
            Churn risk
          </span>
        )}
        {s.isPartner && (
          <span className="rounded-full border border-ink bg-brand px-2 py-0.5 text-xs font-bold text-ink">Partner</span>
        )}
        {s.isSuspended && (
          <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-bold text-red-800">Suspended</span>
        )}
      </div>
      <p className="text-sm text-gray-700">{s.area}</p>
      <p className="mt-1 text-sm">
        <span className="font-semibold">{lastTicketText(s)}</span>
        {' · '}
        {s.avgPerDay7d.toLocaleString('en-IN')} tickets/day (7 days)
        {' · '}
        joined {fmtDate(s.createdAt)}
      </p>
      <p className="mt-1 text-sm text-gray-700">
        {s.owner.name ?? 'Owner'}
        {s.owner.phone && (
          <>
            {' · '}
            <a className="underline" href={`tel:${s.owner.phone}`}>{s.owner.phone}</a>
          </>
        )}
        {!s.owner.phone && s.phone && (
          <>
            {' · '}
            <a className="underline" href={`tel:${s.phone}`}>{s.phone}</a>
          </>
        )}
        {s.owner.email && (
          <>
            {' · '}
            <a className="underline" href={`mailto:${s.owner.email}`}>{s.owner.email}</a>
          </>
        )}
      </p>
      {s.notes && !editing && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-sm">{s.notes}</p>}
      {editing ? (
        <NotesEditor s={s} onDone={() => setEditing(false)} />
      ) : (
        <button type="button" className="btn-secondary mt-2 min-h-11 px-3 text-sm" onClick={() => setEditing(true)}
          aria-label={`Edit notes for ${s.name}`}>
          Edit notes
        </button>
      )}
    </li>
  );
}

export default function SalesPanel() {
  const [filter, setFilter] = useState<Filter>('all');
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['salesActivity'],
    queryFn: fetchSalesActivity,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });

  if (isLoading) return <p role="status" className="text-gray-600">Loading salons...</p>;
  if (!data) {
    return (
      <div className="card text-center">
        <p role="alert" className="mb-4 text-red-700">Couldn't load salon activity. Check your connection and try again.</p>
        <button type="button" className="btn-primary" onClick={() => refetch()}>Try again</button>
      </div>
    );
  }

  const riskCount = data.salons.filter((s) => s.churnRisk).length;
  const partnerCount = data.salons.filter((s) => s.isPartner).length;
  const shown = data.salons.filter((s) => (filter === 'risk' ? s.churnRisk : filter === 'partners' ? s.isPartner : true));
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: `All (${data.salons.length})` },
    { id: 'risk', label: `Churn risk (${riskCount})` },
    { id: 'partners', label: `Partners (${partnerCount})` },
  ];

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-gray-600">Real salons only. Churn risk = no tickets for 3+ days.</p>
        <button type="button" onClick={() => refetch()} disabled={isFetching} aria-busy={isFetching}
          className="btn-secondary min-h-11 px-4 text-sm">
          {isFetching ? 'Updating...' : 'Refresh'}
        </button>
      </div>
      {isError && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-center text-sm text-amber-900">
          Couldn't refresh. Showing the last list.
        </p>
      )}

      <div role="group" aria-label="Show" className="grid grid-cols-3 gap-2">
        {filters.map((f) => {
          const on = f.id === filter;
          return (
            <button key={f.id} type="button" aria-pressed={on} onClick={() => setFilter(f.id)}
              className={`min-h-12 rounded-xl px-2 text-sm ${
                on ? 'border-4 border-ink bg-brand font-bold text-ink' : 'border-2 border-gray-300 bg-white font-medium text-gray-700'
              }`}>
              {f.label}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="text-gray-600">
          {filter === 'risk' ? 'No salons at risk right now.' : filter === 'partners' ? 'No partner salons yet.' : 'No salons yet.'}
        </p>
      ) : (
        <ul aria-label="Salon activity" className="card divide-y divide-gray-200 py-0">
          {shown.map((s) => <SalonCard key={s.id} s={s} />)}
        </ul>
      )}

      <AreaTable areas={data.areas} />
    </div>
  );
}
