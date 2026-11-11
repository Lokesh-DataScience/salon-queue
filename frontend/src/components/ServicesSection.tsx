// frontend/src/components/ServicesSection.tsx
import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchServices,
  createService,
  updateService,
  deleteService,
  type SalonService,
} from '../api/barber';

const SERVICES_KEY = ['barberServices'];

function parseMinutes(value: string): number | null {
  const m = Number(value);
  return value !== '' && Number.isInteger(m) && m >= 1 && m <= 240 ? m : null;
}

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function AddServiceForm() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: createService,
    onSuccess: () => {
      setName('');
      setMinutes('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: SERVICES_KEY });
    },
    onError: (e) => setError(errText(e, 'Could not add the service.')),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const m = parseMinutes(minutes);
    if (!name.trim()) return setError('Enter a service name.');
    if (m === null) return setError('Time must be 1 to 240 minutes.');
    add.mutate({ name: name.trim(), durationMinutes: m });
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid grid-cols-[1fr_6rem] gap-3 border-t border-gray-200 bg-gray-50 px-4 py-4 sm:grid-cols-[1fr_7rem_auto] sm:items-end"
    >
      <p className="col-span-full text-sm font-semibold text-gray-700">Add a service</p>
      <div>
        <label htmlFor="new-service-name" className="mb-1 block text-sm font-medium">Service name</label>
        <input id="new-service-name" className="field" value={name} maxLength={60}
          placeholder="e.g. Haircut"
          onChange={(e) => { setName(e.target.value); setError(null); }} />
      </div>
      <div>
        <label htmlFor="new-service-minutes" className="mb-1 block text-sm font-medium">Time (minutes)</label>
        <input id="new-service-minutes" className="field" inputMode="numeric" value={minutes}
          placeholder="e.g. 20"
          onChange={(e) => { setMinutes(e.target.value.replace(/\D/g, '').slice(0, 3)); setError(null); }} />
      </div>
      {error && <p role="alert" className="col-span-full text-sm text-red-700">{error}</p>}
      <button type="submit" className="btn-primary col-span-2 sm:col-span-1 sm:w-auto" disabled={add.isPending}>
        {add.isPending ? 'Adding...' : 'Add service'}
      </button>
    </form>
  );
}

function ServiceRow({ service }: { service: SalonService }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'view' | 'edit' | 'confirmDelete'>('view');
  const [name, setName] = useState(service.name);
  const [minutes, setMinutes] = useState(String(service.durationMinutes));
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: SERVICES_KEY });

  const save = useMutation({
    mutationFn: (changes: { name?: string; durationMinutes?: number }) => updateService(service.id, changes),
    onSuccess: () => { setMode('view'); setError(null); refresh(); },
    onError: (e) => setError(errText(e, 'Could not save.')),
  });

  const remove = useMutation({
    mutationFn: () => deleteService(service.id),
    onSuccess: refresh,
    onError: (e) => { setMode('view'); setError(errText(e, 'Could not delete.')); },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const m = parseMinutes(minutes);
    if (!name.trim()) return setError('Enter a service name.');
    if (m === null) return setError('Time must be 1 to 240 minutes.');
    const changes: { name?: string; durationMinutes?: number } = {};
    if (name.trim() !== service.name) changes.name = name.trim();
    if (m !== service.durationMinutes) changes.durationMinutes = m;
    if (Object.keys(changes).length === 0) return setMode('view');
    save.mutate(changes);
  }

  if (mode === 'edit') {
    return (
      <li className="bg-brand-soft/40 px-4 py-4">
        <form onSubmit={submit} className="grid gap-3" noValidate>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div>
              <label htmlFor={`name-${service.id}`} className="mb-1 block text-sm font-medium">Service name</label>
              <input id={`name-${service.id}`} className="field" value={name} maxLength={60}
                onChange={(e) => { setName(e.target.value); setError(null); }} />
            </div>
            <div>
              <label htmlFor={`min-${service.id}`} className="mb-1 block text-sm font-medium">Time (minutes)</label>
              <input id={`min-${service.id}`} className="field" inputMode="numeric" value={minutes}
                onChange={(e) => { setMinutes(e.target.value.replace(/\D/g, '').slice(0, 3)); setError(null); }} />
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <button type="submit" className="btn-primary" disabled={save.isPending}>
              {save.isPending ? 'Saving...' : 'Save'}
            </button>
            <button type="button" className="btn-secondary" disabled={save.isPending}
              onClick={() => { setMode('view'); setName(service.name); setMinutes(String(service.durationMinutes)); setError(null); }}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-base font-semibold">{service.name}</p>
          <p className="text-sm text-gray-600">{service.durationMinutes} min</p>
        </div>
        {mode === 'view' && (
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn-sm" onClick={() => setMode('edit')}
              aria-label={`Edit ${service.name}`}>Edit</button>
            <button type="button" className="btn-sm !border-red-300 !text-red-700 hover:!bg-red-50"
              onClick={() => setMode('confirmDelete')}
              aria-label={`Delete ${service.name}`}>Delete</button>
          </div>
        )}
      </div>
      {mode === 'confirmDelete' && (
        <div className="mt-3 grid gap-2 rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-900">Delete this service? Customers will no longer be able to pick it.</p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="btn-primary" disabled={remove.isPending}
              onClick={() => remove.mutate()}>
              {remove.isPending ? 'Deleting...' : 'Yes, delete'}
            </button>
            <button type="button" className="btn-secondary" disabled={remove.isPending}
              onClick={() => setMode('view')}>Keep it</button>
          </div>
        </div>
      )}
      {error && mode === 'view' && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </li>
  );
}

export default function ServicesSection({ welcome = false, asPage = false }: { welcome?: boolean; asPage?: boolean }) {
  const Heading = asPage ? 'h1' : 'h2';
  const ref = useRef<HTMLElement>(null);
  const { data: services, isLoading, error, refetch } = useQuery({
    queryKey: SERVICES_KEY,
    queryFn: fetchServices,
    retry: false,
  });

  useEffect(() => {
    if (welcome) ref.current?.scrollIntoView({ block: 'start' });
  }, [welcome]);

  return (
    <section ref={ref} id="services" aria-labelledby="services-heading" className="mb-8 scroll-mt-4">
      <div className="mb-3">
        <Heading id="services-heading" className={asPage ? 'text-2xl font-bold' : 'text-base font-bold'}>
          Services{services && services.length > 0 ? ` (${services.length})` : ''}
        </Heading>
        <p className="text-sm text-gray-600">What customers pick from when they join your queue.</p>
      </div>

      {welcome && (
        <div role="status" className="card mb-3 grid gap-3 border-brand bg-brand-soft text-sm">
          <p>
            Add the services you offer and how long each takes. Customers will pick from these when they scan your QR.
          </p>
          <Link to="/barber/qr" state={{ welcome: true }} className="btn-primary text-center">
            Done, show my QR code
          </Link>
        </div>
      )}

      {isLoading ? (
        <p role="status" className="text-gray-600">Loading your services...</p>
      ) : error || !services ? (
        <div className="card text-center">
          <p role="alert" className="mb-3 text-red-700">Could not load your services.</p>
          <button type="button" className="btn-secondary" onClick={() => refetch()}>Try again</button>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          {services.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-600">
              No services yet. Customers can still join, using your average time per customer.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {services.map((s) => <ServiceRow key={s.id} service={s} />)}
            </ul>
          )}
          <AddServiceForm />
        </div>
      )}
    </section>
  );
}
