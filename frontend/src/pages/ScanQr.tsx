// frontend/src/pages/ScanQr.tsx
// Customer app "QR स्कैन" tab (/c/scan): scan a salon's wall QR from inside the app.
// Opens that salon's page (/c/s/<code>), which also adds it to "My salons". It does NOT take a
// token by itself: the customer decides on the salon page.
// Uses the browser's own BarcodeDetector where available, otherwise the small jsQR library.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import jsQR from 'jsqr';
import PageShell from '../components/PageShell';
import CustomerHeader from '../components/CustomerHeader';
import Icon from '../components/Icon';
import { useT } from '../lib/i18n';
import { salonCodeFromQr } from '../lib/qrCode';

const TEXT = {
  hi: {
    title: 'QR स्कैन करें',
    subtitle: 'सैलून में लगे QR कोड की ओर कैमरा करें।',
    starting: 'कैमरा चालू कर रहे हैं...',
    aim: 'QR कोड को चौकोर के बीच में रखें',
    denied: 'कैमरे की अनुमति नहीं मिली। फ़ोन की सेटिंग में इस ऐप/साइट को कैमरा की अनुमति दें, फिर दोबारा कोशिश करें।',
    noCamera: 'इस फ़ोन/ब्राउज़र में कैमरा नहीं मिला। फ़ोन के कैमरा ऐप से सैलून का QR स्कैन करें।',
    wrongQr: 'यह सैलून का QR कोड नहीं है। सैलून में लगा हमारा QR कोड स्कैन करें।',
    retry: 'फिर से कोशिश करें',
  },
  en: {
    title: 'Scan QR',
    subtitle: "Point the camera at the salon's QR code.",
    starting: 'Starting the camera...',
    aim: 'Keep the QR code inside the square',
    denied: 'Camera permission was not given. Allow the camera for this app/site in your phone settings, then try again.',
    noCamera: "No camera found on this phone/browser. Scan the salon's QR with your phone's camera app instead.",
    wrongQr: "This isn't a salon QR code. Scan our QR code on the salon wall.",
    retry: 'Try again',
  },
};

type State = 'starting' | 'scanning' | 'denied' | 'noCamera';

interface Detector {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
}

function makeDetector(): Detector | null {
  const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  try {
    return BD ? new BD({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
}

export default function ScanQr() {
  const t = useT(TEXT);
  const navigate = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<State>('starting');
  const [wrong, setWrong] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const detector = makeDetector();
    let lastWrong = '';

    async function read(): Promise<string | null> {
      const v = video.current;
      if (!v || v.readyState < 2 || !v.videoWidth) return null;
      if (detector) {
        const found = await detector.detect(v).catch(() => []);
        return found[0]?.rawValue ?? null;
      }
      if (!ctx) return null;
      // Scan a smaller copy: faster on cheap phones, still plenty for a wall QR.
      const scale = Math.min(1, 480 / v.videoWidth);
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
    }

    async function loop() {
      if (stopped) return;
      const text = await read();
      if (stopped) return;
      if (text) {
        const code = salonCodeFromQr(text);
        if (code) {
          navigator.vibrate?.(80);
          navigate(`/c/s/${code}`, { replace: true });
          return;
        }
        if (text !== lastWrong) {
          lastWrong = text;
          setWrong(true);
        }
      }
      raf = window.setTimeout(() => void loop(), 250) as unknown as number;
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('noCamera');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'noCamera');
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      const v = video.current;
      if (v) {
        v.srcObject = stream;
        try {
          await v.play();
        } catch {
          /* autoplay refused: the muted inline video still shows frames on phones */
        }
      }
      setState('scanning');
      void loop();
    }

    void start();
    return () => {
      stopped = true;
      clearTimeout(raf);
      stream?.getTracks().forEach((tr) => tr.stop()); // camera light goes off when leaving the page
    };
  }, [navigate, attempt]);

  const problem = state === 'denied' ? t.denied : state === 'noCamera' ? t.noCamera : null;

  return (
    <PageShell title={t.title}>
      <CustomerHeader title={t.title} subtitle={t.subtitle} />

      {problem ? (
        <div className="card flex flex-col items-center p-6 text-center">
          <span aria-hidden="true" className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-brand-soft text-ink">
            <Icon name="camera" size={30} />
          </span>
          <p role="alert" className="text-base text-gray-800">{problem}</p>
          {state === 'denied' && (
            <button
              type="button"
              className="btn-primary mt-5"
              onClick={() => {
                setState('starting');
                setAttempt((n) => n + 1);
              }}
            >
              {t.retry}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-black">
            <video ref={video} muted playsInline className="h-full w-full object-cover" aria-hidden="true" />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-brand shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
            />
          </div>
          <p role="status" className="mt-3 text-center text-base text-gray-700">
            {state === 'starting' ? t.starting : t.aim}
          </p>
          {wrong && (
            <p role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-base text-amber-900">
              {t.wrongQr}
            </p>
          )}
        </>
      )}
    </PageShell>
  );
}
