// frontend/src/components/OwnerRatingCard.tsx
// Barber Settings → Salon profile: the salon's customer star rating, with the 1–5 breakdown.
// The owner always sees it; customers see it only from 5 ratings.
import { useQuery } from '@tanstack/react-query';
import { fetchOwnerRating } from '../api/ratings';

export default function OwnerRatingCard() {
  const { data } = useQuery({ queryKey: ['ownerRating'], queryFn: fetchOwnerRating, retry: false });
  if (!data) return null;

  return (
    <section aria-labelledby="owner-rating-title" className="card mb-5">
      <h2 id="owner-rating-title" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Customer rating
      </h2>
      {data.count === 0 ? (
        <p className="mt-2 text-sm text-gray-700">
          No ratings yet. Customers can rate a visit from their ticket after the service is complete.
        </p>
      ) : (
        <>
          <p className="mt-1 text-3xl font-extrabold text-ink">
            <span aria-hidden="true">★ </span>
            {data.average?.toFixed(1)}
            <span className="ml-2 text-base font-medium text-gray-600">
              from {data.count} {data.count === 1 ? 'rating' : 'ratings'}
            </span>
          </p>
          <ul className="mt-3 grid gap-1" aria-label="Ratings by stars">
            {(['5', '4', '3', '2', '1'] as const).map((s) => {
              const n = data.byStars[s] ?? 0;
              return (
                <li key={s} className="flex items-center gap-2 text-sm">
                  <span className="w-8 shrink-0 text-gray-700">{s}★</span>
                  <span aria-hidden="true" className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <span className="block h-full bg-brand" style={{ width: `${(n / data.count) * 100}%` }} />
                  </span>
                  <span className="w-8 shrink-0 text-right tabular-nums text-gray-700">{n}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="mt-3 text-sm text-gray-600">
        {data.publiclyVisible
          ? 'Customers see this rating on your salon page in the app.'
          : `Customers will see your rating once you have ${data.minPublic} ratings.`}
      </p>
    </section>
  );
}
