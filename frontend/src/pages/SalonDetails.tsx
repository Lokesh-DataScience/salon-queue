import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { fetchSalon, fetchSalonQueue } from '../api/salons';

export default function SalonDetails() {
  const { salonId } = useParams<{ salonId: string }>();

  const { data: salon, isLoading, error } = useQuery({
    queryKey: ['salon', salonId],
    queryFn: () => fetchSalon(salonId!),
  });

  const { data: queue } = useQuery({
    queryKey: ['salonQueue', salonId],
    queryFn: () => fetchSalonQueue(salonId!),
    refetchInterval: 10000, // poll every 10s until Milestone 4 adds sockets
  });

  if (isLoading) return <p className="p-6 text-gray-500">Loading salon...</p>;
  if (error || !salon) return <p className="p-6 text-red-600">Salon not found.</p>;

  return (
    <div className="max-w-md mx-auto p-4">
      <h1 className="text-xl font-semibold">{salon.name}</h1>
      <p className="text-sm text-gray-500">{salon.address}</p>
      <p className={`text-sm mt-1 ${salon.is_open ? 'text-green-600' : 'text-red-600'}`}>
        {salon.is_open ? 'Open' : 'Closed'}
      </p>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-600">Current Token: <span className="font-medium">#{queue?.currentToken ?? '-'}</span></p>
        <p className="text-sm text-gray-600">People Waiting: <span className="font-medium">{queue?.waitingCount ?? '-'}</span></p>
        <p className="text-sm text-gray-600">Avg Service Time: {salon.average_service_minutes} min</p>
      </div>

      <Link
        to={`/salons/${salonId}/join`}
        className="mt-6 block text-center rounded-xl bg-black text-white py-3 font-medium"
      >
        Join Queue
      </Link>
    </div>
  );
}