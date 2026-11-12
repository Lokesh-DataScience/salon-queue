// frontend/src/components/admin/FounderSalons.tsx
// Founder → Salons: search the list, open one salon (?salon=<id>), or add a new one.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { fetchAdminSalons } from '../../api/admin';
import SalonBadges from './SalonBadges';
import SalonAdminDetail from './SalonAdminDetail';
import NewSalonForm from './NewSalonForm';
import { useFounderReadOnly } from './useAdminRole';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

export default function FounderSalons() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('salon');
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const readOnly = useFounderReadOnly(); // Cofounder: can look, can't add

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['adminSalons', search],
    queryFn: () => fetchAdminSalons(search || undefined),
    retry: false,
  });

  function open(id: string | null) {
    const next = new URLSearchParams(params);
    if (id) next.set('salon', id);
    else next.delete('salon');
    setParams(next, { replace: true });
  }

  if (selected) return <SalonAdminDetail salonId={selected} onBack={() => open(null)} />;
  if (adding && !readOnly) {
    return (
      <NewSalonForm
        onCancel={() => setAdding(false)}
        onCreated={(id) => {
          setAdding(false);
          open(id);
        }}
      />
    );
  }

  return (
    <div className="grid gap-4">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(draft.trim());
        }}
      >
        <label htmlFor="salon-search" className="sr-only">Search salons</label>
        <input
          id="salon-search"
          type="search"
          className="field flex-1"
          placeholder="Name, phone or address"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={50}
        />
        <button type="submit" className="btn-secondary min-h-12 px-4">Search</button>
      </form>

      {!readOnly && (
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
          Add a salon
        </button>
      )}

      {isLoading && <p role="status" className="text-gray-600">Loading salons...</p>}
      {isError && (
        <div className="card text-center">
          <p role="alert" className="mb-3 text-red-700">Couldn't load salons. Please try again.</p>
          <button type="button" className="btn-secondary" onClick={() => refetch()}>Try again</button>
        </div>
      )}

      {data && data.length === 0 && (
        <p className="text-gray-600">{search ? `No salons match "${search}".` : 'No salons yet.'}</p>
      )}

      {data && data.length > 0 && (
        <ul aria-label="Salons" className="card divide-y divide-gray-200 overflow-hidden p-0">
          {data.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => open(s.id)}
                className="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-brand-soft"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold">{s.name}</span>
                    <SalonBadges s={s} />
                  </span>
                  <span className="block truncate text-sm text-gray-600">{s.address}</span>
                  <span className="block text-xs text-gray-500">
                    {s.owner?.email ?? s.owner?.phone ?? 'No owner'} · joined {fmtDate(s.createdAt)}
                  </span>
                </span>
                <span aria-hidden="true" className="text-xl text-gray-500">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && data.length === 200 && (
        <p className="text-sm text-gray-600">Showing the newest 200. Search to find others.</p>
      )}
    </div>
  );
}
