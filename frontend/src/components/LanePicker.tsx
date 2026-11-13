// frontend/src/components/LanePicker.tsx
// "Who would you like?" Shown only for salons with two or more barbers.
// value === null means "Any barber": the server puts the customer in the shortest line.
import type { PublicLane } from '../api/salons';
import { useT } from '../lib/i18n';

const TEXT = {
  hi: {
    legend: 'बार्बर चुनें',
    any: 'कोई भी बार्बर',
    allBreak: 'सब ब्रेक पर हैं',
    noWaitNow: 'अभी कोई इंतज़ार नहीं',
    shortest: (m: number) => `सबसे कम इंतज़ार · ~${m} मिनट`,
    onBreak: 'ब्रेक पर',
    noWait: 'कोई इंतज़ार नहीं',
    nextInLine: (m: number) => `अगला नंबर आपका · ~${m} मिनट`,
    waiting: (w: number, m: number) => `${w} इंतज़ार में · ~${m} मिनट`,
  },
  en: {
    legend: 'Choose your barber',
    any: 'Any barber',
    allBreak: 'Everyone is on a break',
    noWaitNow: 'No wait right now',
    shortest: (m: number) => `Shortest wait · ~${m} min`,
    onBreak: 'On a break',
    noWait: 'No wait',
    nextInLine: (m: number) => `Next in line · ~${m} min`,
    waiting: (w: number, m: number) => `${w} waiting · ~${m} min`,
  },
};

interface Props {
  lanes: PublicLane[];
  value: string | null;
  onChange: (laneId: string | null) => void;
  disabled?: boolean;
}

function waitText(t: (typeof TEXT)['en'], lane: PublicLane): string {
  if (lane.isPaused) return t.onBreak;
  if (lane.estimatedWaitMinutes <= 0) return t.noWait;
  if (lane.waitingCount === 0) return t.nextInLine(lane.estimatedWaitMinutes);
  return t.waiting(lane.waitingCount, lane.estimatedWaitMinutes);
}

export default function LanePicker({ lanes, value, onChange, disabled }: Props) {
  const t = useT(TEXT);
  const open = lanes.filter((l) => !l.isPaused);
  const shortest = Math.min(...open.map((l) => l.estimatedWaitMinutes));
  const options: { id: string | null; title: string; detail: string; unavailable?: boolean }[] = [
    {
      id: null,
      title: t.any,
      detail: open.length === 0 ? t.allBreak : shortest <= 0 ? t.noWaitNow : t.shortest(shortest),
      unavailable: open.length === 0,
    },
    ...lanes.map((l) => ({ id: l.id, title: l.name, detail: waitText(t, l), unavailable: !!l.isPaused })),
  ];

  return (
    <fieldset className="mb-6" disabled={disabled}>
      <legend className="mb-2 text-lg font-semibold">{t.legend}</legend>
      <div className="grid gap-2">
        {options.map((o) => {
          const selected = o.id === value;
          return (
            <label
              key={o.id ?? 'any'}
              className={`flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-xl border-2 p-3 ${
                selected ? 'border-ink bg-brand-soft' : 'border-gray-300 bg-white'
              } ${o.unavailable ? 'opacity-60' : ''
              } focus-within:ring-2 focus-within:ring-ink`}
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="barber"
                  className="h-5 w-5 accent-black"
                  checked={selected}
                  disabled={o.unavailable}
                  onChange={() => onChange(o.id)}
                />
                <span className="font-semibold">{o.title}</span>
              </span>
              <span className="text-sm text-gray-700">{o.detail}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
