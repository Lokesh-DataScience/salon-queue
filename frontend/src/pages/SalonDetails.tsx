import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { fetchSalon, fetchSalonQueue } from '../api/salons';
import PageShell from '../components/PageShell';
import ResumeTicketBanner from '../components/ResumeTicketBanner';

export default function SalonDetails() {
  const { salonId } = useParams<{ salonId: string }>();

  const { data: salon, isLoading, error } = useQuery({
    queryKey: ['salon', salonId],
    queryFn: () => fetchSalon(salonId!),
  });

  const { data: queue } = useQuery({
    queryKey: ['salonQueue', salonId],
    queryFn: () => fetchSalonQueue(salonId!),
    refetchInterval: 10000, // unchanged: see note below about polling
  });

  if (isLoading) {
    return (
      <PageShell title="Loading salon">
        <p role="status" className="text-gray-600">Loading salon...</p>
      </PageShell>
    );
  }
  if (error || !salon) {
    return (
      <PageShell title="Salon not found">
        <p role="alert" className="text-red-700">We couldn't find this salon.</p>
        <Link to="/salons" className="btn-secondary mt-6">Back to nearby salons</Link>
      </PageShell>
    );
  }

  return (
    <PageShell title={salon.name}>
      <Link to="/salons" className="mb-3 inline-block min-h-11 py-2 text-sm text-gray-600 underline">
        ← Nearby salons
      </Link>
      <ResumeTicketBanner salonId={salonId} />
      <h1 className="break-words text-xl font-semibold">{salon.name}</h1>
      <p className="text-sm text-gray-600">{salon.address}</p>
      <p className={`mt-1 text-sm font-medium ${salon.is_open ? 'text-green-700' : 'text-red-700'}`}>
        <span aria-hidden="true">{salon.is_open ? '🟢 ' : '🔴 '}</span>
        {salon.is_open ? 'Open' : 'Closed'}
      </p>

      <dl className="card mt-4 space-y-2 text-sm text-gray-700">
        <div className="flex justify-between gap-4">
          <dt>Current token</dt>
          <dd className="font-medium">#{queue?.currentToken ?? '-'}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>People waiting</dt>
          <dd className="font-medium">{queue?.waitingCount ?? '-'}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Average service time</dt>
          <dd className="font-medium">{salon.average_service_minutes} min</dd>
        </div>
      </dl>

      {salon.is_open ? (
        <Link to={`/salons/${salonId}/join`} className="btn-primary mt-6">Join queue</Link>
      ) : (
        <p role="status" className="mt-6 rounded-xl border border-red-300 bg-red-50 p-4 text-red-900">
          This salon is currently closed, so its queue isn't open.
        </p>
      )}
    </PageShell>
  );
}