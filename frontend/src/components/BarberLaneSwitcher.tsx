// frontend/src/components/BarberLaneSwitcher.tsx
// The owner's switch between barbers' lines. Staff never see it: they only have their own line.
import type { BarberLaneSummary } from '../api/barber';

interface Props {
  lanes: BarberLaneSummary[];
  /** null = the owner's own line (what the server shows by default). */
  selectedId: string | null;
  onSelect: (laneId: string | null) => void;
}

export default function BarberLaneSwitcher({ lanes, selectedId, onSelect }: Props) {
  return (
    <div role="group" aria-label="Barber lines" className="mb-3 flex gap-2 overflow-x-auto pb-1">
      {lanes.map((l) => {
        const selected = selectedId === null ? l.isMine : l.id === selectedId;
        return (
          <button
            key={l.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(l.isMine ? null : l.id)}
            className={`min-h-14 shrink-0 rounded-xl border-2 px-4 text-left ${
              selected ? 'border-ink bg-brand font-bold' : 'border-gray-300 bg-white font-medium'
            }`}
          >
            <span className="block text-base">{l.isMine ? `${l.name} (you)` : l.name}</span>
            <span className="block text-xs text-gray-700">
              {l.isPaused ? 'On a break · ' : l.busy ? 'Serving · ' : ''}
              {l.waitingCount} waiting
            </span>
          </button>
        );
      })}
    </div>
  );
}
