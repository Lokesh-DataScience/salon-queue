// frontend/src/components/RateVisit.tsx
// On a COMPLETED ticket: "How was your visit?" with 1–5 stars. One tap saves; tapping again changes it.
// Shown only while the visit can be rated (up to 7 days after it finished).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMyRating, rateVisit } from '../api/ratings';
import { useT } from '../lib/i18n';

const TEXT = {
  hi: {
    title: 'आपकी सेवा कैसी रही?',
    hint: 'स्टार दबाकर बताएँ। आपका नाम या नंबर किसी को नहीं दिखता।',
    star: (n: number) => `${n} स्टार`,
    saving: 'सेव कर रहे हैं...',
    thanks: (n: number) => `धन्यवाद! आपने ${n} स्टार दिए। बदलना हो तो फिर से दबाएँ।`,
    failed: 'रेटिंग सेव नहीं हुई। फिर से कोशिश करें।',
  },
  en: {
    title: 'How was your visit?',
    hint: 'Tap the stars. Your name and number are never shown to anyone.',
    star: (n: number) => `${n} star${n === 1 ? '' : 's'}`,
    saving: 'Saving...',
    thanks: (n: number) => `Thank you! You gave ${n} star${n === 1 ? '' : 's'}. Tap again to change it.`,
    failed: "Your rating wasn't saved. Please try again.",
  },
};

function Star({ filled }: { filled: boolean }) {
  return (
    <svg width={36} height={36} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"
        fill={filled ? 'var(--color-brand)' : 'none'}
        stroke="var(--color-ink)"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function RateVisit({ ticketId, accessToken }: { ticketId: string; accessToken: string }) {
  const t = useT(TEXT);
  const queryClient = useQueryClient();
  const key = ['myRating', ticketId];
  const [hover, setHover] = useState<number | null>(null);

  const { data } = useQuery({
    queryKey: key,
    queryFn: () => fetchMyRating(ticketId, accessToken),
    retry: false,
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: (stars: number) => rateVisit(ticketId, accessToken, stars),
    onSuccess: (r) => queryClient.setQueryData(key, { stars: r.stars, canRate: true }),
  });

  if (!data?.canRate) return null;
  const current = save.isPending ? (save.variables ?? data.stars) : data.stars;
  const shown = hover ?? current ?? 0;

  return (
    <section aria-labelledby="rate-title" className="mt-5 rounded-2xl border-2 border-ink bg-white p-4 text-center">
      <h2 id="rate-title" className="text-lg font-bold text-ink">{t.title}</h2>
      <div role="radiogroup" aria-labelledby="rate-title" className="mt-2 flex justify-center gap-1" onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={current === n}
            aria-label={t.star(n)}
            disabled={save.isPending}
            onMouseEnter={() => setHover(n)}
            onClick={() => save.mutate(n)}
            className="flex h-12 w-12 items-center justify-center rounded-full hover:bg-brand-soft"
          >
            <Star filled={n <= shown} />
          </button>
        ))}
      </div>
      <p role="status" className="mt-2 text-sm text-gray-700">
        {save.isPending ? t.saving : current ? t.thanks(current) : t.hint}
      </p>
      {save.isError && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {t.failed}
        </p>
      )}
    </section>
  );
}
