// frontend/src/components/admin/FounderSection.tsx
// The Founder tab: Numbers (Slice 1), Salons (Slice 2), Team and Audit log (Slice 3). Kept in the address (?view=).
import { useSearchParams } from 'react-router-dom';
import FounderPanel from './FounderPanel';
import FounderSalons from './FounderSalons';
import TeamPanel from './TeamPanel';
import AuditPanel from './AuditPanel';

const VIEWS = [
  { id: 'numbers', label: 'Numbers' },
  { id: 'salons', label: 'Salons' },
  { id: 'team', label: 'Team' },
  { id: 'audit', label: 'Audit log' },
] as const;
type View = (typeof VIEWS)[number]['id'];

export default function FounderSection() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('view');
  const view: View = VIEWS.some((v) => v.id === requested) ? (requested as View) : 'numbers';

  function choose(v: View) {
    const next = new URLSearchParams(params);
    next.set('view', v);
    next.delete('salon');
    setParams(next, { replace: true });
  }

  return (
    <div className="grid gap-4">
      <div role="group" aria-label="Founder view" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {VIEWS.map((v) => {
          const on = v.id === view;
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={on}
              onClick={() => choose(v.id)}
              className={`min-h-12 rounded-xl px-3 text-base ${
                on ? 'border-4 border-ink bg-brand font-bold text-ink' : 'border-2 border-gray-300 bg-white font-medium text-gray-700'
              }`}
            >
              {v.label}
            </button>
          );
        })}
      </div>
      {view === 'numbers' && <FounderPanel />}
      {view === 'salons' && <FounderSalons />}
      {view === 'team' && <TeamPanel />}
      {view === 'audit' && <AuditPanel />}
    </div>
  );
}
