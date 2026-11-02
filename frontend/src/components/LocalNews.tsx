// frontend/components/LocalNews.tsx
import { useQuery } from '@tanstack/react-query';
import { fetchSalonFeed } from '../api/feed';

export default function LocalNews({ salonId }: { salonId: string }) {
  const { data } = useQuery({
    queryKey: ['feed', salonId],
    queryFn: () => fetchSalonFeed(salonId),
    staleTime: 10 * 60 * 1000, // the backend refreshes daily; no need to ask often
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (!data || data.length === 0) return null;

  return (
    <section aria-label="While you wait" className="card mt-4 p-0">
      <h2 className="px-4 pt-4 text-sm font-semibold uppercase tracking-wide text-gray-600">
        While you wait
      </h2>
      <ul className="divide-y divide-gray-200">
        {data.map((item) => (
          <li key={item.url}>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              className="block px-4 py-3 hover:bg-gray-50"
            >
              <span className="line-clamp-2 break-words text-base font-medium text-gray-900">
                {item.title}
              </span>
              {item.source && <span className="mt-1 block text-xs text-gray-600">{item.source}</span>}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}