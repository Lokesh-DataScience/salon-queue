import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchNearbySalons } from '../api/salons';
import { useGeolocation } from '../hooks/useGeolocation';

export default function SalonList() {
  const { coords, error: geoError, loading: geoLoading } = useGeolocation();

  const { data: salons, isLoading, error } = useQuery({
    queryKey: ['nearbySalons', coords?.lat, coords?.lng],
    queryFn: () => fetchNearbySalons(coords!.lat, coords!.lng),
    enabled: !!coords,
  });

  if (geoLoading) return <p className="p-6 text-gray-500">Finding your location...</p>;
  if (geoError) return <p className="p-6 text-red-600">{geoError}</p>;
  if (isLoading) return <p className="p-6 text-gray-500">Finding nearby salons...</p>;
  if (error) return <p className="p-6 text-red-600">Unable to load salons. Please try again.</p>;

  return (
    <div className="max-w-md mx-auto p-4">
      <h1 className="text-xl font-semibold mb-4">Nearby Salons</h1>
      <div className="space-y-3">
        {salons?.map((s: any) => (
          <Link
            key={s.id}
            to={`/salons/${s.id}`}
            className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
          >
            <div className="flex justify-between items-start">
              <h2 className="font-medium">{s.name}</h2>
              <span className={s.is_open ? 'text-green-600 text-sm' : 'text-red-600 text-sm'}>
                {s.is_open ? '🟢 Open' : '🔴 Closed'}
              </span>
            </div>
            <p className="text-sm text-gray-500">{s.distance_km.toFixed(1)} km away</p>
            <p className="text-sm text-gray-600 mt-1">
              👥 {s.queue_size} waiting · ⏱ ~{s.estimated_wait_minutes} min
            </p>
          </Link>
        ))}
        {salons?.length === 0 && (
          <p className="text-gray-500 text-sm">No salons found within 5km.</p>
        )}
      </div>
    </div>
  );
}