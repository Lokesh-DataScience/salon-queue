// frontend/src/components/admin/TechSection.tsx
// The Tech tab: Health (Slice 7), Errors & sign-ins (Slice 8) and Queues (Slice 9). Kept in the address (?view=).
import { useSearchParams } from 'react-router-dom';
import TechPanel from './TechPanel';
import EventsPanel from './EventsPanel';
import QueueHealthPanel from './QueueHealthPanel';

const VIEWS = [
  { id: 'health', label: 'Health' },
  { id: 'events', label: 'Errors & sign-ins' },
  { id: 'queues', label: 'Queues' },
] as const;
type View = (typeof VIEWS)[number]['id'];

export default function TechSection() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('view');
  const view: View = VIEWS.some((v) => v.id === requested) ? (requested as View) : 'health';

  function choose(v: View) {
    const next = new URLSearchParams(params);
    next.set('view', v);
    setParams(next, { replace: true });
  }

  return (
    <div className="grid gap-4">
      <div role="group" aria-label="Tech view" className="grid grid-cols-3 gap-2">
        {VIEWS.map((v) => {
          const on = v.id === view;
          return (
            <button key={v.id} type="button" aria-pressed={on} onClick={() => choose(v.id)}
              className={`min-h-12 rounded-xl px-3 text-base ${
                on ? 'border-4 border-ink bg-brand font-bold text-ink' : 'border-2 border-gray-300 bg-white font-medium text-gray-700'
              }`}>
              {v.label}
            </button>
          );
        })}
      </div>
      {view === 'health' && <TechPanel />}
      {view === 'events' && <EventsPanel />}
      {view === 'queues' && <QueueHealthPanel />}
    </div>
  );
}
