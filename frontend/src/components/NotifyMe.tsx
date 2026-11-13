// frontend/src/components/NotifyMe.tsx
// Notification setup on the ticket page: turn alerts on/off, see whether they are on, send a test,
// and clear help when the phone can't (iPhone outside the Home Screen, blocked, unsupported).
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPushConfig, enablePush, disablePush, pushSupport, sendTestPush } from '../lib/push';
import { ApiError } from '../api/client';
import { useLang, useT } from '../lib/i18n';
import Icon from './Icon';

type Props = { ticketId: string; accessToken: string; enabled: boolean };

const TEXT = {
  hi: {
    onTitle: 'सूचना चालू है',
    onBody: 'इंटरनेट चालू रखें, यह पेज बंद कर सकते हैं। बारी पास आने पर हम बताएँगे।',
    turnOff: 'सूचना बंद करें',
    turningOff: 'बंद कर रहे हैं...',
    offFailed: 'सूचना बंद नहीं हो पाई। फिर से कोशिश करें।',
    test: 'टेस्ट सूचना भेजें',
    testing: 'भेज रहे हैं...',
    testSent: 'टेस्ट भेज दिया — कुछ सेकंड में फ़ोन पर दिखेगा। न दिखे तो फ़ोन की सेटिंग में इस ऐप/साइट की सूचना चालू करें।',
    testNoSub: 'इस फ़ोन पर सूचना चालू नहीं मिली। नीचे से फिर चालू करें।',
    testTooSoon: 'थोड़ी देर बाद फिर से टेस्ट भेजें।',
    testFailed: 'टेस्ट नहीं भेज पाए। फिर से कोशिश करें।',
    turnOn: 'बारी पास आने पर सूचना दें',
    turningOn: 'चालू कर रहे हैं...',
    denied: 'इस साइट की सूचना बंद (ब्लॉक) है। ब्राउज़र सेटिंग में अनुमति दें, या यह पेज खुला रखें।',
    onFailed: 'सूचना चालू नहीं हो पाई। फिर से कोशिश करें, या यह पेज खुला रखें।',
    ios: 'iPhone पर सूचना के लिए यह साइट होम स्क्रीन पर जोड़ें (Share, फिर Add to Home Screen)। नहीं तो यह पेज खुला रखें।',
    unsupported: 'यह ब्राउज़र सूचना नहीं भेज सकता, इसलिए कृपया यह पेज खुला रखें।',
    blocked: 'इस साइट की सूचना बंद (ब्लॉक) है। सूचना पाने के लिए ब्राउज़र सेटिंग में अनुमति दें, या यह पेज खुला रखें।',
    blockedHow: 'Chrome में: ऊपर ⋮ → Settings → Site settings → Notifications → इस साइट को Allow करें।',
  },
  en: {
    onTitle: 'Notifications are on',
    onBody: "Keep your internet on and you can close this page. We'll alert you when your turn is close.",
    turnOff: 'Turn off notifications',
    turningOff: 'Turning off...',
    offFailed: "We couldn't turn off notifications. Please try again.",
    test: 'Send a test notification',
    testing: 'Sending...',
    testSent: "Test sent — it should appear in a few seconds. If it doesn't, allow notifications for this app/site in your phone settings.",
    testNoSub: "Notifications aren't on for this phone. Turn them on again below.",
    testTooSoon: 'Please wait a little before sending another test.',
    testFailed: "We couldn't send the test. Please try again.",
    turnOn: "Notify me when it's almost my turn",
    turningOn: 'Turning on...',
    denied: 'Notifications are blocked for this site. Allow them in your browser settings, or keep this page open.',
    onFailed: "We couldn't turn on notifications. Please try again, or keep this page open.",
    ios: 'On iPhone, add this site to your Home Screen (Share, then Add to Home Screen) to get notifications. Otherwise, keep this page open.',
    unsupported: "This browser can't send notifications, so please keep this page open.",
    blocked:
      'Notifications are blocked for this site. Allow them in your browser settings to get an alert, or keep this page open.',
    blockedHow: 'In Chrome: ⋮ (top right) → Settings → Site settings → Notifications → Allow this site.',
  },
};

export default function NotifyMe({ ticketId, accessToken, enabled }: Props) {
  const queryClient = useQueryClient();
  const t = useT(TEXT);
  const lang = useLang();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testState, setTestState] = useState<{ ok: boolean; text: string } | null>(null);
  const { data: config } = useQuery({
    queryKey: ['pushConfig'],
    queryFn: fetchPushConfig,
    staleTime: Infinity,
    retry: false,
  });

  // Server has push switched off (or unreachable): say nothing, the page's "keep this page open" line stays.
  if (!config?.enabled || !config.publicKey) return null;
  const publicKey = config.publicKey;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await enablePush(ticketId, accessToken, publicKey);
      if (result === 'denied') {
        setMessage(t.denied);
      } else {
        await refresh();
      }
    } catch (err) {
      // Shown in the browser console so a failure can be diagnosed.
      console.error(
        '[push] could not enable notifications:',
        err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error',
      );
      setMessage(t.onFailed);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    setTestState(null);
    try {
      await disablePush(ticketId, accessToken);
      await refresh();
    } catch {
      setMessage(t.offFailed);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setTestState(null);
    try {
      await sendTestPush(ticketId, accessToken, lang);
      setTestState({ ok: true, text: t.testSent });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === 'NO_SUBSCRIPTION' || code === 'EXPIRED') {
        setTestState({ ok: false, text: t.testNoSub });
        await refresh(); // the server no longer has a subscription: show "turn on" again
      } else {
        setTestState({ ok: false, text: code === 'TOO_SOON' ? t.testTooSoon : t.testFailed });
      }
    } finally {
      setBusy(false);
    }
  }

  if (enabled) {
    return (
      <div className="mt-4 rounded-2xl border border-green-300 bg-green-50 p-4 text-green-900" role="status">
        <p className="flex items-center gap-2 font-semibold">
          <Icon name="bell" size={20} />
          {t.onTitle}
        </p>
        <p className="mt-1 text-sm">{t.onBody}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => void test()} disabled={busy} className="btn-secondary">
            {busy ? t.testing : t.test}
          </button>
          <button type="button" onClick={() => void turnOff()} disabled={busy} className="btn-secondary">
            {busy ? t.turningOff : t.turnOff}
          </button>
        </div>
        {testState && (
          <p className={`mt-2 text-sm ${testState.ok ? 'text-green-900' : 'text-red-800'}`} role={testState.ok ? undefined : 'alert'}>
            {testState.text}
          </p>
        )}
        {message && <p className="mt-2 text-sm text-red-800" role="alert">{message}</p>}
      </div>
    );
  }

  const support = pushSupport();
  if (support === 'ios-install') {
    return <p className="mt-4 rounded-xl border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">{t.ios}</p>;
  }
  if (support === 'unsupported') {
    return <p className="mt-4 text-sm text-gray-600">{t.unsupported}</p>;
  }

  const blocked = typeof Notification !== 'undefined' && Notification.permission === 'denied';
  if (blocked) {
    return (
      <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
        <p>{t.blocked}</p>
        <p className="mt-1 font-medium">{t.blockedHow}</p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <button type="button" onClick={() => void turnOn()} disabled={busy} className="btn-primary gap-2">
        <Icon name="bell" />
        {busy ? t.turningOn : t.turnOn}
      </button>
      {message && <p className="mt-2 text-sm text-red-800" role="alert">{message}</p>}
    </div>
  );
}
