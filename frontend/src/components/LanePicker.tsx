// frontend/src/components/LanePicker.tsx
// "Who would you like?" Shown only for salons with two or more barbers.
// value === null means "Any barber": the server puts the customer in the shortest line.
import type { PublicLane } from '../api/salons';

interface Props {
  lanes: PublicLane[];
  value: string | null;
  onChange: (laneId: string | null) => void;
  disabled?: boolean;
}

function waitText(lane: PublicLane): string {
  if (lane.isPaused) return 'On a break';
  if (lane.estimatedWaitMinutes <= 0) return 'No wait';
  if (lane.waitingCount === 0) return `Next in line · ~${lane.estimatedWaitMinutes} min`;
  return `${lane.waitingCount} waiting · ~${lane.estimatedWaitMinutes} min`;
}

export default function LanePicker({ lanes, value, onChange, disabled }: Props) {
  const open = lanes.filter((l) => !l.isPaused);
  const shortest = Math.min(...open.map((l) => l.estimatedWaitMinutes));
  const options: { id: string | null; title: string; detail: string; unavailable?: boolean }[] = [
    {
      id: null,
      title: 'Any barber',
      detail:
        open.length === 0
          ? 'Everyone is on a break'
          : shortest <= 0
            ? 'No wait right now'
            : `Shortest wait · ~${shortest} min`,
      unavailable: open.length === 0,
    },
    ...lanes.map((l) => ({ id: l.id, title: l.name, detail: waitText(l), unavailable: !!l.isPaused })),
  ];

  return (
    <fieldset className="mb-6" disabled={disabled}>
      <legend className="mb-2 text-lg font-semibold">Choose your barber</legend>
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
