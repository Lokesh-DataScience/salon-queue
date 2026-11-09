// frontend/src/pages/BarberCustomers.tsx
// The salon's own customer list (owner only). Everyone here joined THIS salon's queue and ticked the consent line.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import CustomerLine from '../components/CustomerLine';
import { deleteCustomer, fetchCustomers, type SalonCustomer } from '../api/barber';
import { ApiError } from '../api/client';

const CUSTOMERS_KEY = ['barberCustomers'];

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

export default function BarberCustomers() {
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<SalonCustomer | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Wait for a pause in typing so every key press is not a request.
  useEffect(() => {
    const t = setTimeout(() => setSearch(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...CUSTOMERS_KEY, search],
    queryFn: () => fetchCustomers(search || undefined),
    retry: false,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCustomer(id),
    onSuccess: () => {
      setTarget(null);
      queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY });
      queryClient.invalidateQueries({ queryKey: ['barberQueue'] }); // their name leaves the queue rows too
    },
    onError: (e: unknown) => {
      setTarget(null);
      setActionError(e instanceof Error ? e.message : 'Could not delete. Please try again.');
    },
  });

  const forbidden = error instanceof ApiError && error.status === 403;

  return (
    <PageShell title="Customers">
      <Link to="/barber/settings" className="mb-3 inline-block min-h-11 py-2 text-sm text-gray-600 underline">
        ← Back to settings
      </Link>
      <h1 className="mb-1 text-xl font-semibold">Customers</h1>
      <p className="mb-4 text-sm text-gray-600">
        People who joined your queue and agreed to be saved. Only you can see this list.
      </p>

      {!forbidden && (
        <div className="mb-4">
          <label htmlFor="customer-search" className="mb-1 block text-sm font-medium">Search by name or number</label>
          <input
            id="customer-search"
            type="search"
            className="field"
            value={typed}
            maxLength={40}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
      )}

      {actionError && (
        <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {actionError}
        </p>
      )}

      {isLoading ? (
        <p role="status" className="text-gray-600">Loading customers...</p>
      ) : forbidden ? (
        <p role="alert" className="card text-red-800">Only the salon owner can see the customer list.</p>
      ) : error || !data ? (
        <div className="card text-center">
          <p role="alert" className="mb-3 text-red-700">Could not load your customers.</p>
          <button type="button" className="btn-secondary" onClick={() => refetch()}>Try again</button>
        </div>
      ) : data.length === 0 ? (
        <p className="rounded-xl border-2 border-dashed border-gray-300 p-4 text-center text-gray-600">
          {search ? 'No one matches that search.' : 'No customers yet. They appear here after they join your queue.'}
        </p>
      ) : (
        <>
          <p className="mb-2 text-sm font-semibold text-gray-700">
            {data.length} {data.length === 1 ? 'customer' : 'customers'}
          </p>
          <ul className="grid gap-3">
            {data.map((c) => (
              <li key={c.id} className="card flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CustomerLine name={c.name} phone={c.phone} />
                  <p className="text-sm text-gray-600">
                    {c.visitCount} {c.visitCount === 1 ? 'visit' : 'visits'} · first {day(c.firstVisitAt)} · last {day(c.lastVisitAt)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Delete ${c.name}`}
                  onClick={() => { setActionError(null); setTarget(c); }}
                  className="min-h-11 shrink-0 rounded-xl border-2 border-red-300 px-3 text-sm font-medium text-red-700 hover:bg-red-50"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {target && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/50 p-4" onClick={() => !remove.isPending && setTarget(null)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            className="mx-auto w-full max-w-md rounded-2xl border-2 border-ink bg-white p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-title" className="text-xl font-bold text-ink">Delete {target.name}?</h2>
            <p className="mt-1 text-sm text-gray-700">
              Their name and number are removed from your list. Any ticket they hold stays in the queue, without a name.
              If they scan again, they will be asked for their details again.
            </p>
            <div className="mt-4 grid gap-3">
              <button type="button" className="btn-primary" disabled={remove.isPending} onClick={() => remove.mutate(target.id)}>
                {remove.isPending ? 'Deleting...' : 'Yes, delete'}
              </button>
              <button type="button" className="btn-secondary" disabled={remove.isPending} onClick={() => setTarget(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}