// frontend/src/components/admin/SalesSection.tsx
// The Sales tab: Salons (Slice 4), Onboarding (Slice 5) and Leads (Slice 6). Kept in the address (?view=).
import { useSearchParams } from 'react-router-dom';
import SalesPanel from './SalesPanel';
import OnboardingPanel from './OnboardingPanel';
import LeadsPanel from './LeadsPanel';

const VIEWS = [
  { id: 'salons', label: 'Salons' },
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'leads', label: 'Leads' },
] as const;
type View = (typeof VIEWS)[number]['id'];

export default function SalesSection() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('view');
  const view: View = VIEWS.some((v) => v.id === requested) ? (requested as View) : 'salons';

  function choose(v: View) {
    const next = new URLSearchParams(params);
    next.set('view', v);
    setParams(next, { replace: true });
  }

  return (
    <div className="grid gap-4">
      <div role="group" aria-label="Sales view" className="grid grid-cols-3 gap-2">
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
      {view === 'salons' && <SalesPanel />}
      {view === 'onboarding' && <OnboardingPanel />}
      {view === 'leads' && <LeadsPanel />}
    </div>
  );
}
