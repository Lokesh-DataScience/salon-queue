// frontend/src/pages/ShopLink.tsx — use the shop on another phone (/c/shop/link), Commerce C4b (§9.4).
// The phone that has the orders shows an 8-character code (10 minutes, works once). The other phone — or the
// iPhone home-screen app, which keeps its own storage apart from Safari — types it and then sees the same orders.
// A phone number or order number alone never links anything.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import CustomerHeader from '../components/CustomerHeader';
import { createLinkCode, redeemLinkCode } from '../api/shopOrders';
import { useT } from '../lib/i18n';

const TEXT = {
  hi: {
    title: 'दूसरे फ़ोन पर इस्तेमाल करें',
    back: 'मेरे ऑर्डर',
    intro:
      'जिस फ़ोन से ऑर्डर किया था, उस पर कोड बनाएँ। फिर दूसरे फ़ोन (या iPhone की होम-स्क्रीन ऐप) में वह कोड डालें।',
    showTitle: '1. इस फ़ोन पर कोड बनाएँ',
    show: 'कोड बनाएँ',
    making: 'बना रहे हैं...',
    codeIs: 'दूसरे फ़ोन में यह कोड डालें:',
    expires: (m: number) => `${m} मिनट में खत्म होगा · एक ही बार चलेगा`,
    expired: 'कोड का समय खत्म हो गया। नया कोड बनाएँ।',
    enterTitle: '2. दूसरे फ़ोन का कोड यहाँ डालें',
    codeLabel: '8 अक्षर का कोड',
    link: 'जोड़ें',
    linking: 'जोड़ रहे हैं...',
    done: 'हो गया! अब यह फ़ोन वही ऑर्डर देख सकता है।',
    never: 'यह कोड किसी को भी न बताएँ — दुकान वाले कभी कोड नहीं माँगते।',
  },
  en: {
    title: 'Use on another phone',
    back: 'My Orders',
    intro:
      'Make a code on the phone you ordered from. Then type it on the other phone (or in the iPhone home-screen app).',
    showTitle: '1. Make a code on this phone',
    show: 'Make a code',
    making: 'Making...',
    codeIs: 'Type this code on the other phone:',
    expires: (m: number) => `Expires in ${m} min · works once`,
    expired: 'The code has expired. Make a new one.',
    enterTitle: '2. Type the code from the other phone',
    codeLabel: '8-character code',
    link: 'Link',
    linking: 'Linking...',
    done: 'Done! This phone now sees the same orders.',
    never: 'Never share this code with anyone — the shop will never ask you for it.',
  },
};

const errText = (e: unknown) =>
  e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.';

// Minutes left on the code. "now" is set when the code arrives and then every 15 s (never read during render).
function useMinutesLeft(expiresAt: string | null) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [expiresAt]);
  const left =
    expiresAt && now
      ? Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000))
      : null;
  return { left, start: () => setNow(Date.now()) };
}

export default function ShopLink() {
  const t = useT(TEXT);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const timer = useMinutesLeft(expiresAt);
  const left = timer.left;
  const make = useMutation({
    mutationFn: createLinkCode,
    onSuccess: (d) => {
      setExpiresAt(d.expiresAt);
      timer.start();
    },
  });
  const redeem = useMutation({
    mutationFn: () => redeemLinkCode(code),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['shopMyOrders'] });
      await qc.invalidateQueries({ queryKey: ['shopPrefill'] });
      setTimeout(() => navigate('/c/shop/orders'), 1200);
    },
  });

  return (
    <PageShell title={t.title}>
      <CustomerHeader title={t.title} backTo="/c/shop/orders" backLabel={t.back} />
      <p className="mb-4 text-base text-gray-800">{t.intro}</p>

      <section className="card grid gap-3" aria-label={t.showTitle}>
        <h2 className="text-lg font-semibold">{t.showTitle}</h2>
        {make.data && left !== null && left > 0 ? (
          <>
            <p className="text-base">{t.codeIs}</p>
            <p
              className="select-all text-center font-mono text-4xl font-extrabold tracking-widest text-ink"
              aria-live="polite"
            >
              {make.data.code}
            </p>
            <p className="text-center text-sm text-gray-600">{t.expires(left)}</p>
            <p className="text-sm font-semibold text-red-800">{t.never}</p>
          </>
        ) : (
          <>
            {make.data && (
              <p role="status" className="text-sm text-gray-700">
                {t.expired}
              </p>
            )}
            <button
              type="button"
              className="btn-primary min-h-12"
              disabled={make.isPending}
              onClick={() => make.mutate()}
            >
              {make.isPending ? t.making : t.show}
            </button>
          </>
        )}
        {make.isError && (
          <p role="alert" className="text-sm text-red-800">
            {errText(make.error)}
          </p>
        )}
      </section>

      <form
        className="card mt-4 grid gap-3"
        aria-label={t.enterTitle}
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) redeem.mutate();
        }}
      >
        <h2 className="text-lg font-semibold">{t.enterTitle}</h2>
        <div>
          <label htmlFor="link-code" className="mb-1 block text-base font-medium">
            {t.codeLabel}
          </label>
          <input
            id="link-code"
            className="field text-center font-mono text-2xl uppercase tracking-widest"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            maxLength={9}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        {redeem.isError && (
          <p role="alert" className="text-sm text-red-800">
            {errText(redeem.error)}
          </p>
        )}
        {redeem.isSuccess && (
          <p role="status" className="text-base font-semibold text-green-800">
            {t.done}
          </p>
        )}
        <button
          type="submit"
          className="btn-primary min-h-12"
          disabled={redeem.isPending || redeem.isSuccess || code.trim().length < 8}
        >
          {redeem.isPending ? t.linking : t.link}
        </button>
      </form>
    </PageShell>
  );
}
