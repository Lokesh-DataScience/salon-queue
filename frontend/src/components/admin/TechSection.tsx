// frontend/src/components/admin/TechSection.tsx
// The Tech tab: Health (7), Errors & sign-ins (8), Queues (9), Bugs (10), Tools & flags (11) and Code history. Kept in the address (?view=).
import { useSearchParams } from 'react-router-dom';
import TechPanel from './TechPanel';
import EventsPanel from './EventsPanel';
import QueueHealthPanel from './QueueHealthPanel';
import BugsPanel from './BugsPanel';
import ToolsPanel from './ToolsPanel';
import CodeHistoryPanel from './CodeHistoryPanel';

const VIEWS = [
  { id: 'health', label: 'Health' },
  { id: 'events', label: 'Errors & sign-ins' },
  { id: 'queues', label: 'Queues' },
  { id: 'bugs', label: 'Bugs' },
  { id: 'tools', label: 'Tools & flags' },
  { id: 'code', label: 'Code history' },
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
      <div role="group" aria-label="Tech view" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
      {view === 'bugs' && <BugsPanel />}
      {view === 'tools' && <ToolsPanel />}
      {view === 'code' && <CodeHistoryPanel />}
    </div>
  );
}
