// frontend/src/components/admin/FounderSection.tsx
// The Founder tab: "Numbers" (Slice 1) and "Salons" (Slice 2). The choice is kept in the address (?view=).
import { useSearchParams } from 'react-router-dom';
import FounderPanel from './FounderPanel';
import FounderSalons from './FounderSalons';

const VIEWS = [
  { id: 'numbers', label: 'Numbers' },
  { id: 'salons', label: 'Salons' },
] as const;
type View = (typeof VIEWS)[number]['id'];

export default function FounderSection() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'salons' ? 'salons' : 'numbers';

  function choose(v: View) {
    const next = new URLSearchParams(params);
    next.set('view', v);
    next.delete('salon');
    setParams(next, { replace: true });
  }

  return (
    <div className="grid gap-4">
      <div role="group" aria-label="Founder view" className="grid grid-cols-2 gap-2">
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
      {view === 'numbers' ? <FounderPanel /> : <FounderSalons />}
    </div>
  );
}
