// frontend/src/components/admin/OnboardingPanel.tsx
// Sales → Onboarding: how far new salons get, and who is stuck at which step (with a number to call).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchSalesOnboarding,
  type OnboardingFunnel,
  type OnboardingPeriod,
  type OnboardingSalon,
  type OnboardingStepId,
} from '../../api/admin';

const PERIODS: { id: OnboardingPeriod; label: string }[] = [
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
  { id: 'all', label: 'All time' },
];

// What the sales partner should do for salons stuck at each step.
const STUCK: Record<OnboardingStepId, { title: string; tip: string }> = {
  services: { title: 'Have not added services', tip: 'Help them add their services in Settings.' },
  first_ticket: { title: 'No ticket yet', tip: 'Show them how to start the queue or add a walk-in with +1.' },
  first_qr: { title: 'Walk-ins only, no QR scans', tip: 'Check the QR poster is printed and on the wall.' },
  active: { title: 'Stopped using it', tip: 'No ticket for 7+ days. Call and ask what went wrong.' },
};

const pct = (n: number, of: number) => (of === 0 ? 0 : Math.round((n / of) * 100));
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

function Funnel({ f }: { f: OnboardingFunnel }) {
  const rows = [{ id: 'registered', label: 'Registered', count: f.registered, outOf: f.registered }, ...f.steps];
  return (
    <section aria-label="Funnel" className="card">
      <h3 className="mb-3 text-base font-semibold">How far salons get</h3>
      <ol className="grid gap-3">
        {rows.map((r) => {
          const p = pct(r.count, r.outOf);
          return (
            <li key={r.id}>
              <div className="flex justify-between gap-2 text-sm">
                <span className="font-medium">{r.label}</span>
                <span className="tabular-nums">{r.count} of {r.outOf} · {p}%</span>
              </div>
              <div aria-hidden="true" className="mt-1 h-3 w-full rounded-full bg-gray-100">
                <div className="h-3 rounded-full bg-ink" style={{ width: `${p}%` }} />
              </div>
            </li>
          );
        })}
      </ol>
      {f.steps.some((s) => s.id === 'active' && s.outOf < f.registered) && (
        <p className="mt-3 text-xs text-gray-600">"Still active" only counts salons registered at least 7 days ago.</p>
      )}
      {f.medianDaysToFirstTicket !== null && (
        <p className="mt-2 text-sm text-gray-700">
          Typical time from sign-up to first ticket: <strong>{f.medianDaysToFirstTicket} days</strong>
        </p>
      )}
    </section>
  );
}

function StuckGroup({ step, salons }: { step: OnboardingStepId; salons: OnboardingSalon[] }) {
  const s = STUCK[step];
  return (
    <details className="card" open={salons.length > 0 && salons.length <= 5}>
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 font-semibold">
        <span>{s.title}</span>
        <span className="tabular-nums">{salons.length}</span>
      </summary>
      <p className="mb-2 text-sm text-gray-600">{s.tip}</p>
      {salons.length === 0 ? (
        <p className="text-sm text-gray-600">Nobody here.</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {salons.map((x) => (
            <li key={x.id} className="py-2">
              <p className="font-medium">
                {x.name}
                {x.isSuspended && <span className="ml-2 text-xs font-bold text-red-800">(suspended)</span>}
              </p>
              <p className="text-sm text-gray-700">
                {x.area} · joined {fmtDate(x.createdAt)}
                {x.owner.phone && (
                  <>
                    {' · '}
                    <a className="underline" href={`tel:${x.owner.phone}`}>{x.owner.phone}</a>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export default function OnboardingPanel() {
  const [period, setPeriod] = useState<OnboardingPeriod>('30');
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['salesOnboarding', period],
    queryFn: () => fetchSalesOnboarding(period),
    retry: false,
  });

  return (
    <div className="grid gap-4">
      <div role="group" aria-label="Registered in" className="grid grid-cols-3 gap-2">
        {PERIODS.map((p) => (
          <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}
            className={`min-h-11 rounded-xl px-2 text-sm ${
              period === p.id ? 'border-4 border-ink bg-brand font-bold text-ink' : 'border-2 border-gray-300 bg-white font-medium text-gray-700'
            }`}>
            {p.label}
          </button>
        ))}
      </div>

      {isLoading && <p role="status" className="text-gray-600">Loading onboarding...</p>}
      {isError && !data && (
        <div className="card text-center">
          <p role="alert" className="mb-3 text-red-700">Couldn't load onboarding.</p>
          <button type="button" className="btn-secondary" onClick={() => refetch()}>Try again</button>
        </div>
      )}

      {data && data.registered === 0 && <p className="text-gray-600">No salons registered in this period.</p>}
      {data && data.registered > 0 && (
        <>
          <Funnel f={data} />
          <h3 className="text-base font-semibold">Stuck at</h3>
          {(Object.keys(STUCK) as OnboardingStepId[]).map((step) => (
            <StuckGroup key={step} step={step} salons={data.salons.filter((s) => s.nextStep === step)} />
          ))}
        </>
      )}
    </div>
  );
}
