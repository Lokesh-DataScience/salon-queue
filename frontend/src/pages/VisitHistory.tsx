// frontend/src/pages/VisitHistory.tsx
// Customer app "इतिहास" tab (/c/history): the last 50 finished visits on this phone.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell';
import CustomerHeader from '../components/CustomerHeader';
import Icon from '../components/Icon';
import { useLang, useT } from '../lib/i18n';
import { clearVisits, getVisits, MAX_VISITS, type Visit, type VisitOutcome } from '../lib/visitHistory';

const TEXT = {
  hi: {
    title: 'इतिहास',
    subtitle: (n: number) => `पिछली ${n} विज़िट तक, सिर्फ़ इसी फ़ोन में।`,
    token: (n: number) => `टोकन #${n}`,
    COMPLETED: 'सेवा पूरी हुई',
    SKIPPED: 'बारी छूट गई',
    CANCELLED: 'आपने लाइन छोड़ी',
    salon: 'सैलून',
    emptyTitle: 'अभी कोई इतिहास नहीं',
    emptyBody: 'आपकी पूरी हुई विज़िट यहाँ दिखेंगी।',
    clear: 'इतिहास मिटाएँ',
    clearAsk: 'पूरा इतिहास इस फ़ोन से मिटाएँ?',
    clearYes: 'हाँ, मिटाएँ',
    clearNo: 'रहने दें',
  },
  en: {
    title: 'History',
    subtitle: (n: number) => `Your last ${n} visits, kept only on this phone.`,
    token: (n: number) => `Token #${n}`,
    COMPLETED: 'Service done',
    SKIPPED: 'Turn was skipped',
    CANCELLED: 'You left the queue',
    salon: 'Salon',
    emptyTitle: 'No history yet',
    emptyBody: 'Your finished visits will show here.',
    clear: 'Clear history',
    clearAsk: 'Clear all history from this phone?',
    clearYes: 'Yes, clear',
    clearNo: 'Keep',
  },
};

const TONE: Record<VisitOutcome, string> = {
  COMPLETED: 'bg-green-100 text-green-900',
  SKIPPED: 'bg-amber-100 text-amber-900',
  CANCELLED: 'bg-gray-100 text-gray-800',
};

function when(at: number, lang: 'hi' | 'en') {
  return new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(at);
}

function VisitRow({ v }: { v: Visit }) {
  const t = useT(TEXT);
  const lang = useLang();
  const body = (
    <span className="flex items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-bold text-ink">{v.salonName || t.salon}</span>
        <span className="block text-sm text-gray-600">
          {t.token(v.tokenNumber)} · {when(v.at, lang)}
        </span>
      </span>
      <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${TONE[v.outcome]}`}>{t[v.outcome]}</span>
      {v.salonCode && <Icon name="chevron" className="shrink-0 text-gray-500" />}
    </span>
  );
  return (
    <li>
      {v.salonCode ? (
        <Link to={`/c/s/${v.salonCode}`} className="block hover:bg-gray-50">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

export default function VisitHistory() {
  const t = useT(TEXT);
  const [visits, setVisits] = useState(() => getVisits());
  const [confirm, setConfirm] = useState(false);

  return (
    <PageShell title={t.title}>
      <CustomerHeader title={t.title} subtitle={t.subtitle(MAX_VISITS)} />

      {visits.length === 0 ? (
        <div className="card flex flex-col items-center p-6 text-center">
          <span aria-hidden="true" className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-brand-soft text-ink">
            <Icon name="clock" size={30} />
          </span>
          <p className="text-lg font-semibold">{t.emptyTitle}</p>
          <p className="mt-2 text-base text-gray-700">{t.emptyBody}</p>
        </div>
      ) : (
        <>
          <ul className="card divide-y divide-gray-200 overflow-hidden p-0">
            {visits.map((v) => (
              <VisitRow key={v.ticketId} v={v} />
            ))}
          </ul>
          <div className="mt-6">
            {!confirm ? (
              <button type="button" className="btn-secondary" onClick={() => setConfirm(true)}>
                {t.clear}
              </button>
            ) : (
              <div role="alertdialog" aria-label={t.clearAsk} className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="mb-3 text-base text-red-900">{t.clearAsk}</p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="btn-danger flex-1"
                    onClick={() => {
                      clearVisits();
                      setVisits([]);
                      setConfirm(false);
                    }}
                  >
                    {t.clearYes}
                  </button>
                  <button type="button" className="btn-secondary flex-1" onClick={() => setConfirm(false)}>
                    {t.clearNo}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </PageShell>
  );
}
