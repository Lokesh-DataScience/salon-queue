// frontend/src/components/InstallAppBanner.tsx
// Under the token number on the ticket page: "next time, take your token from home — get the app".
//   Android with Chrome's install ready -> one tap opens Chrome's install dialog
//   Android without it                  -> short steps for Chrome's menu
//   iPhone                              -> short steps for Share -> Add to Home Screen
//   inside the installed app, or dismissed in the last 7 days, or any other browser -> nothing
import { useState } from 'react';
import { isInstalledApp } from '../lib/appManifest';
import { isAndroid, isIOS, promptInstall, useInstallState } from '../lib/installPrompt';

const DISMISS_KEY = 'svq.installBanner.dismissedAt';
const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000;

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

function rememberDismiss() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* storage unavailable: the banner simply comes back next time */
  }
}

const STEPS: Record<'ios' | 'android', { title: string; steps: string[] }> = {
  ios: {
    title: 'iPhone पर ऐप ऐसे जोड़ें',
    steps: [
      'नीचे Share बटन (⬆️) दबाएँ।',
      '“Add to Home Screen” (होम स्क्रीन में जोड़ें) चुनें।',
      'ऊपर “Add” दबाएँ। अब होम स्क्रीन पर “सैलून टोकन” खोलें।',
    ],
  },
  android: {
    title: 'ऐप ऐसे इंस्टॉल करें',
    steps: [
      'ऊपर दाईं ओर Chrome का मेनू (⋮) दबाएँ।',
      '“ऐप इंस्टॉल करें” या “होम स्क्रीन में जोड़ें” चुनें।',
      '“इंस्टॉल करें” दबाएँ। अब होम स्क्रीन पर “सैलून टोकन” खोलें।',
    ],
  },
};

export default function InstallAppBanner() {
  const { canPrompt, justInstalled } = useInstallState();
  const [dismissed, setDismissed] = useState(dismissedRecently);
  const [sheet, setSheet] = useState<'ios' | 'android' | null>(null);
  const [busy, setBusy] = useState(false);

  if (isInstalledApp() || justInstalled || dismissed) return null;
  const mode: 'prompt' | 'ios' | 'android' | null = canPrompt ? 'prompt' : isIOS() ? 'ios' : isAndroid() ? 'android' : null;
  if (!mode) return null;

  async function onGetApp() {
    if (mode === 'prompt') {
      setBusy(true);
      const outcome = await promptInstall();
      setBusy(false);
      // Chrome can refuse to show it a second time: fall back to the menu steps.
      if (outcome === 'unavailable') setSheet('android');
      return;
    }
    if (mode) setSheet(mode);
  }

  function onLater() {
    rememberDismiss();
    setDismissed(true);
  }

  return (
    <>
      <section
        aria-label="ऐप डाउनलोड करें"
        className="relative mt-4 rounded-2xl border-2 border-ink bg-white p-4 shadow-[0_4px_0_0_var(--color-ink)]"
      >
        <button
          type="button"
          onClick={onLater}
          aria-label="बाद में"
          className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full text-xl text-gray-500 hover:bg-gray-100"
        >
          ✕
        </button>
        <div className="flex items-center gap-3 pr-10">
          <img src="/icon-192.png" alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-xl" />
          <div>
            <p className="text-lg font-extrabold leading-snug text-ink">अगली बार घर बैठे टोकन लें</p>
            <p className="text-sm text-gray-700">लाइन देखें, घर से टोकन लें, बारी आने पर सूचना पाएँ।</p>
          </div>
        </div>
        <button type="button" className="btn-primary mt-3" onClick={() => void onGetApp()} disabled={busy}>
          {busy ? 'खुल रहा है...' : 'ऐप डाउनलोड करें'}
        </button>
      </section>

      {sheet && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/50 p-4" onClick={() => setSheet(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-steps-title"
            className="mx-auto w-full max-w-md rounded-2xl border-2 border-ink bg-white p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="install-steps-title" className="text-xl font-bold text-ink">
              {STEPS[sheet].title}
            </h2>
            <ol className="mt-3 list-decimal space-y-2 pl-6 text-base text-gray-800">
              {STEPS[sheet].steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            {/* Android's installed app shares Chrome's storage; an iPhone home-screen app starts empty. */}
            {sheet === 'android' && <p className="mt-3 text-sm text-gray-600">आपका यह सैलून ऐप में अपने-आप दिखेगा।</p>}
            <button type="button" className="btn-primary mt-4" onClick={() => setSheet(null)}>
              ठीक है
            </button>
          </div>
        </div>
      )}
    </>
  );
}
