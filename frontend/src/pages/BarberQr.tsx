// frontend/src/pages/BarberQr.tsx
// The salon's wall poster: one QR, printed and stuck up like a UPI QR. Scanning it gives the customer a token.
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { fetchBarberSalon } from '../api/barber';
import PageShell from '../components/PageShell';

// Repeating comb + scissors pattern drawn in the logo's navy. Transparent, so the yellow shows through.
const scissors = (x: number, y: number, rot: number) => `
  <g transform="translate(${x} ${y}) rotate(${rot})" fill="none" stroke="#1B2036" stroke-width="4.5" stroke-linecap="round">
    <circle cx="-12" cy="17" r="8"/><circle cx="12" cy="17" r="8"/>
    <line x1="-7" y1="8" x2="9" y2="-27"/><line x1="7" y1="8" x2="-9" y2="-27"/>
    <circle cx="0" cy="-7" r="2.5" fill="#1B2036" stroke="none"/>
  </g>`;

const comb = (x: number, y: number, rot: number) => `
  <g transform="translate(${x} ${y}) rotate(${rot})" fill="#1B2036">
    <rect x="-26" y="-12" width="52" height="18" rx="5"/>
    ${[-23, -16, -9, -2, 5, 12, 19]
      .map((tx) => `<rect x="${tx}" y="4" width="4" height="14" rx="2"/>`)
      .join('')}
  </g>`;

const PATTERN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <g opacity="0.85">
    ${scissors(45, 45, -30)}
    ${comb(135, 45, 35)}
    ${comb(45, 135, -45)}
    ${scissors(135, 135, 25)}
  </g>
</svg>`;

const PATTERN_URL = `url("data:image/svg+xml,${encodeURIComponent(PATTERN_SVG)}")`;

// Makes browsers print the yellow and the pattern instead of dropping backgrounds.
const keepColors = {
  WebkitPrintColorAdjust: 'exact',
  printColorAdjust: 'exact',
} as React.CSSProperties;

export default function BarberQr() {
  const welcome = (useLocation().state as { welcome?: boolean } | null)?.welcome;
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

  return (
    <PageShell title="Salon QR code">
      {/* No browser margins/headers when printing, so the poster can fill the whole page. */}
      <style>{`@page { margin: 0; }`}</style>

      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link to="/barber/settings" className="inline-block min-h-11 py-2 text-sm text-gray-600 underline">
          ← Back to settings
        </Link>
      </div>
      {welcome && (
        <p role="status" className="mb-4 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 print:hidden">
          Your salon is registered. Print this QR code and put it where customers can see it. Then open your
          dashboard to start serving.
        </p>
      )}

      <section
        aria-label="Printable salon QR poster"
        style={{ ...keepColors, backgroundImage: PATTERN_URL, backgroundSize: '180px 180px' }}
        className="rounded-3xl border-2 border-ink bg-brand px-5 py-14 print:fixed print:inset-0 print:z-50 print:flex print:items-center print:justify-center print:rounded-none print:border-0 print:p-0"
      >
        <div className="rounded-3xl bg-white p-6 text-center shadow-lg print:w-[78%] print:max-w-2xl print:p-10">
          <div className="mx-auto w-full max-w-xs print:max-w-md">
            <QRCodeSVG
              value={url}
              size={512}
              level="H"
              marginSize={1}
              fgColor="#1B2036"
              bgColor="#FFFFFF"
              imageSettings={{ src: '/icon-192.png', height: 100, width: 100, excavate: true }}
              title={`QR code for ${salon.name}`}
              className="h-auto w-full"
            />
          </div>

          <h1 className="mt-4 text-3xl font-extrabold uppercase tracking-tight text-ink print:text-5xl">
            {salon.name}
          </h1>
          <p className="mt-2 text-lg font-semibold text-ink print:text-3xl">Scan to get your queue token</p>
          <p className="text-base text-gray-700 print:text-2xl">QR स्कैन करें, अपना टोकन नंबर पाएं</p>

          <ol className="mx-auto mt-4 max-w-xs space-y-1 text-left text-sm text-gray-700 print:max-w-md print:text-xl">
            <li>1. Open your phone camera and scan</li>
            <li>2. Get your token number instantly</li>
            <li>3. Follow your turn on your phone</li>
          </ol>
          <p className="mt-3 text-xs text-gray-600 print:text-lg">No app. No sign-up.</p>
        </div>
      </section>

      <div className="mt-4 space-y-3 print:hidden">
        <button type="button" onClick={() => window.print()} className="btn-primary">
          Print this QR code
        </button>
        <p className="text-sm text-gray-600">
          Stick it where customers can see it, like your UPI QR. In the print window you can also choose
          “Save as PDF”.
        </p>
        <p className="break-all text-xs text-gray-500">Link behind the QR: {url}</p>
      </div>
    </PageShell>
  );
}