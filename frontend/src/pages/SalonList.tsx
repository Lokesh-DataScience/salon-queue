import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchNearbySalons } from '../api/salons';
import { useGeolocation } from '../hooks/useGeolocation';
import PageShell from '../components/PageShell';
import ResumeTicketBanner from '../components/ResumeTicketBanner';

export default function SalonList() {
  const { coords, error: geoError, loading: geoLoading } = useGeolocation();

  const { data: salons, isLoading, isError, refetch } = useQuery({
    queryKey: ['nearbySalons', coords?.lat, coords?.lng],
    queryFn: () => fetchNearbySalons(coords!.lat, coords!.lng),
    enabled: !!coords,
  });

  let body;
  if (geoLoading) {
    body = <p role="status" className="text-gray-600">Finding your location...</p>;
  } else if (geoError) {
    body = (
      <div role="alert" className="card border-red-300 bg-red-50">
        <p className="text-red-900">{geoError}</p>
        <p className="mt-1 text-sm text-red-900">
          To see salons near you, allow location access in your browser settings, then try again.
        </p>
        <button type="button" onClick={() => window.location.reload()} className="btn-secondary mt-3">
          Try again
        </button>
      </div>
    );
  } else if (isLoading) {
    body = <p role="status" className="text-gray-600">Finding nearby salons...</p>;
  } else if (isError) {
    body = (
      <div role="alert" className="card border-red-300 bg-red-50">
        <p className="text-red-900">Unable to load salons. Please try again.</p>
        <button type="button" onClick={() => refetch()} className="btn-secondary mt-3">
          Try again
        </button>
      </div>
    );
  } else if (!salons || salons.length === 0) {
    body = <p className="text-gray-600">No salons found within 5 km.</p>;
  } else {
    body = (
      <ul className="grid gap-3 md:grid-cols-2">
        {salons.map((s: any) => (
          <li key={s.id}>
            <Link to={`/salons/${s.id}`} className="card block hover:border-gray-400">
              <div className="flex items-start justify-between gap-3">
                <h2 className="break-words font-medium">{s.name}</h2>
                <span className={`shrink-0 text-sm font-medium ${s.is_open ? 'text-green-700' : 'text-red-700'}`}>
                  <span aria-hidden="true">{s.is_open ? '🟢 ' : '🔴 '}</span>
                  {s.is_open ? 'Open' : 'Closed'}
                </span>
              </div>
              <p className="text-sm text-gray-600">{s.distance_km.toFixed(1)} km away</p>
              <p className="mt-1 text-sm text-gray-700">
                <span aria-hidden="true">👥 </span>{s.queue_size} waiting ·{' '}
                <span aria-hidden="true">⏱ </span>~{s.estimated_wait_minutes} min
              </p>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <PageShell title="Nearby salons" width="wide">
      <h1 className="mb-4 text-xl font-semibold">Nearby salons</h1>
      <ResumeTicketBanner />
      {body}
    </PageShell>
  );
}