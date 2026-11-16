// frontend/src/pages/BarberQr.tsx
// The salon's wall poster: one QR, printed and stuck up like a UPI QR. Scanning it gives the customer a token.
// The artwork is shared (/qr-poster-bg.jpg, 1024x1536). On top of it we draw, per salon:
//   - the salon name and phone in the navy header tab
//   - this salon's own QR (join link only, never the phone) with the logo in the middle
// It is one SVG, so the screen, the print and the downloaded image all look the same.
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { fetchBarberSalon } from '../api/barber';
import PageShell from '../components/PageShell';
import BackLink from '../components/BackLink';
import { displayPhone } from '../lib/phoneLink';

const BG_SRC = '/qr-poster-bg.jpg';
const LOGO_SRC = '/icon-192.png';

// Positions in the artwork (1024 x 1536).
const W = 1024;
const H = 1536;
const NAVY = '#081425';
const HEADER_POINTS = '232,4 793,4 752,112 276,112'; // inside of the navy tab, which narrows downwards
const HEADER_MAX_W = 470;
const QR_BOX = { x: 256, y: 404, w: 512, h: 502 }; // covers the sample QR in the artwork
const QR_SIZE = 470;
const QR_CX = 512;
const QR_CY = 655;
const FONT = "Poppins, 'Segoe UI', Roboto, 'Noto Sans Devanagari', Arial, sans-serif";

// Rough width of bold capitals, as a share of the font size. Only used to choose a size;
// textLength below makes sure nothing ever spills out of the tab.
const CHAR_W = 0.66;
const fitSize = (text: string, start: number) =>
  Math.max(20, Math.min(start, Math.floor(HEADER_MAX_W / (Math.max(1, [...text].length) * CHAR_W))));
const tooWide = (text: string, size: number) => [...text].length * size * CHAR_W > HEADER_MAX_W;

// Split at the space that makes the two lines most even.
function splitInTwo(text: string): [string, string] | null {
  const words = text.split(/\s+/);
  if (words.length < 2) return null;
  let best = 1;
  for (let i = 2; i < words.length; i++) {
    const d = (k: number) => Math.abs(words.slice(0, k).join(' ').length - words.slice(k).join(' ').length);
    if (d(i) < d(best)) best = i;
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

type HeaderLine = { text: string; y: number; size: number };

// Exported for the tests.
export function headerLayout(name: string, hasPhone: boolean): { name: HeaderLine[]; phone?: { y: number; size: number } } {
  const one = fitSize(name, hasPhone ? 50 : 56);
  const two = one < 34 ? splitInTwo(name) : null;
  if (!two) {
    return { name: [{ text: name, y: hasPhone ? 42 : 60, size: one }], ...(hasPhone && { phone: { y: 91, size: 31 } }) };
  }
  const size = Math.min(fitSize(two[0], hasPhone ? 32 : 42), fitSize(two[1], hasPhone ? 32 : 42));
  const ys = hasPhone ? [26, 60] : [38, 82];
  return {
    name: two.map((text, i) => ({ text, y: ys[i], size })),
    ...(hasPhone && { phone: { y: 95, size: 26 } }),
  };
}

// Makes browsers print the artwork instead of dropping it.
const keepColors = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as React.CSSProperties;

function toDataUrl(src: string): Promise<string> {
  return fetch(src)
    .then((r) => r.blob())
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        }),
    );
}

// Turns the poster SVG into a 2048x3072 PNG. Pictures inside an SVG are not loaded when it is drawn
// as an image, so the artwork and logo are put inside it as data first.
async function posterPng(svg: SVGSVGElement): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(W * 2));
  clone.setAttribute('height', String(H * 2));
  const cache = new Map<string, Promise<string>>();
  await Promise.all(
    [...clone.querySelectorAll('image')].map(async (img) => {
      const src = img.getAttribute('href') ?? img.getAttribute('xlink:href');
      if (!src || src.startsWith('data:')) return;
      if (!cache.has(src)) cache.set(src, toDataUrl(src));
      img.setAttribute('href', await cache.get(src)!);
      img.removeAttribute('xlink:href');
    }),
  );
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }),
  );
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('poster image failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = W * 2;
    canvas.height = H * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!png) throw new Error('no png');
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const fileName = (salonName: string) =>
  `${salonName.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'salon'}-qr.png`;

export default function BarberQr() {
  const welcome = (useLocation().state as { welcome?: boolean } | null)?.welcome;
  const svgRef = useRef<SVGSVGElement>(null);
  const [saving, setSaving] = useState<'download' | 'share' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { data: salon, isLoading, error } = useQuery({
    queryKey: ['barberSalon'],
    queryFn: fetchBarberSalon,
    retry: false,
  });

  if (isLoading) return <p role="status" className="p-6 text-gray-600">Loading your QR code...</p>;

  if (error || !salon) {
    return (
      <PageShell title="Salon QR code">
        <div className="text-center">
          <p role="alert" className="mb-4 text-red-700">Not signed in, or your session expired.</p>
          <Link to="/barber/login" className="btn-primary">Go to Login</Link>
        </div>
      </PageShell>
    );
  }

  // Built from the address this page is opened on, so it always points at the live site.
  const url = `${window.location.origin}/q/${salon.qrCode}`;
  const name = salon.name.trim().toUpperCase();
  const phone = salon.phone ? displayPhone(salon.phone) : '';
  const layout = headerLayout(name, !!phone);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  async function save(kind: 'download' | 'share') {
    if (!svgRef.current || !salon) return;
    setSaving(kind);
    setSaveError(null);
    try {
      const png = await posterPng(svgRef.current);
      const file = new File([png], fileName(salon.name), { type: 'image/png' });
      if (kind === 'share' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: salon.name }).catch(() => {}); // closing the share sheet is fine
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      }
    } catch {
      setSaveError('Could not make the image. Please use Print instead, or try again.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <PageShell title="Salon QR code">
      {/* No browser margins/headers when printing, so the poster can fill the whole page. */}
      <style>{`@page { size: A4 portrait; margin: 0; }`}</style>

      <div className="mb-4 flex items-center justify-between print:hidden">
        <BackLink />
      </div>
      <h1 className="sr-only">{`${salon.name}: QR code poster`}</h1>
      {welcome && (
        <p role="status" className="mb-4 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 print:hidden">
          Your salon is registered. Print this QR code and put it where customers can see it. Then open your
          dashboard to start serving.
        </p>
      )}

      <section
        aria-label="Printable salon QR poster"
        style={keepColors}
        className="print:fixed print:inset-0 print:z-50 print:flex print:items-center print:justify-center print:bg-white"
      >
        <svg
          ref={svgRef}
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-labelledby="poster-title"
          className="mx-auto block h-auto w-full max-w-md rounded-3xl shadow-lg print:h-screen print:w-auto print:max-w-none print:rounded-none print:shadow-none"
        >
          <title id="poster-title">{`QR poster for ${salon.name}`}</title>
          <image href={BG_SRC} x="0" y="0" width={W} height={H} preserveAspectRatio="none" />

          {/* Header: cover the artwork's sample text, then this salon's name and phone. */}
          <polygon points={HEADER_POINTS} fill={NAVY} />
          <g fill="#FFFFFF" fontFamily={FONT} textAnchor="middle" dominantBaseline="central">
            {layout.name.map((l) => (
              <text
                key={l.y}
                x={W / 2}
                y={l.y}
                fontSize={l.size}
                fontWeight={800}
                {...(tooWide(l.text, l.size) && { textLength: HEADER_MAX_W, lengthAdjust: 'spacingAndGlyphs' })}
              >
                {l.text}
              </text>
            ))}
            {/* Plain text for customers who want to call. The QR itself only holds the join link. */}
            {layout.phone && (
              <text x={W / 2} y={layout.phone.y} fontSize={layout.phone.size} fontWeight={700}>
                <tspan>Call: </tspan>
                <tspan>{phone}</tspan>
              </text>
            )}
          </g>

          {/* QR: a clean white box over the artwork's sample QR, then the real one. */}
          <rect x={QR_BOX.x} y={QR_BOX.y} width={QR_BOX.w} height={QR_BOX.h} rx={14} fill="#FFFFFF" />
          <QRCodeSVG
            value={url}
            x={QR_CX - QR_SIZE / 2}
            y={QR_CY - QR_SIZE / 2}
            size={QR_SIZE}
            level="H"
            marginSize={0}
            fgColor={NAVY}
            bgColor="#FFFFFF"
            imageSettings={{ src: LOGO_SRC, height: 96, width: 96, excavate: true }}
          />
        </svg>
      </section>

      <div className="mx-auto mt-4 max-w-md space-y-3 print:hidden">
        <button type="button" onClick={() => window.print()} className="btn-primary">
          Print this QR code
        </button>
        <div className={`grid gap-3 ${canShare ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <button type="button" onClick={() => void save('download')} disabled={!!saving} className="btn-secondary">
            {saving === 'download' ? 'Making image...' : 'Download image'}
          </button>
          {canShare && (
            <button type="button" onClick={() => void save('share')} disabled={!!saving} className="btn-secondary">
              {saving === 'share' ? 'Making image...' : 'Share (WhatsApp)'}
            </button>
          )}
        </div>
        {saveError && <p role="alert" className="text-sm text-red-700">{saveError}</p>}
        <p className="text-sm text-gray-600">
          Stick it where customers can see it, like your UPI QR. You can also send the image to a print shop.
        </p>
        <p className="break-all text-xs text-gray-500">Link behind the QR: {url}</p>
      </div>
    </PageShell>
  );
}
