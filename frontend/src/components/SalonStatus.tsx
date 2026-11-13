// frontend/src/components/SalonStatus.tsx
// Open / paused / closed, always as a dot AND words (never colour alone).
import { useT } from '../lib/i18n';

export type SalonState = 'open' | 'paused' | 'closed';

export function salonState(q: { isOpen: boolean; isPaused: boolean }): SalonState {
  return !q.isOpen ? 'closed' : q.isPaused ? 'paused' : 'open';
}

const TEXT = {
  hi: { open: 'खुला है', paused: 'लाइन रुकी हुई है', closed: 'अभी बंद है' },
  en: { open: 'Open', paused: 'Queue paused', closed: 'Closed now' },
};

const STYLE: Record<SalonState, { dot: string; text: string }> = {
  open: { dot: 'bg-green-600', text: 'text-green-800' },
  paused: { dot: 'bg-amber-500', text: 'text-amber-800' },
  closed: { dot: 'bg-gray-400', text: 'text-gray-700' },
};

export default function SalonStatus({ state, className = '' }: { state: SalonState; className?: string }) {
  const t = useT(TEXT);
  const s = STYLE[state];
  return (
    <span className={`inline-flex items-center gap-2 font-semibold ${s.text} ${className}`}>
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} />
      {t[state]}
    </span>
  );
}
