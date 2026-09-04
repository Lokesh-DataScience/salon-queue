import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

interface HealthResponse {
  status: string;
  timestamp: string;
}

export default function HealthPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/api/health'),
  });

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm w-full rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold mb-4">Backend Health Check</h1>
        {isLoading && <p className="text-neutral-500">Checking...</p>}
        {isError && (
          <p className="text-red-600">
            Unable to reach backend: {(error as Error).message}
          </p>
        )}
        {data && (
          <div className="space-y-1">
            <p className="text-green-600 font-medium">Status: {data.status}</p>
            <p className="text-sm text-neutral-500">As of {data.timestamp}</p>
          </div>
        )}
      </div>
    </div>
  );
}