// frontend/src/pages/BarberQr.tsx
// The salon's wall poster: one QR, printed and stuck up like a UPI QR. Scanning it gives the customer a token.
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { fetchBarberSalon } from '../api/barber';
import PageShell from '../components/PageShell';

export default function BarberQr() {
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
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link to="/barber/dashboard" className="inline-block min-h-11 py-2 text-sm text-gray-600 underline">
          ← Back to dashboard
        </Link>
      </div>

      <section
        aria-label="Printable salon QR poster"
        className="rounded-2xl border border-gray-300 bg-white p-6 text-center print:rounded-none print:border-0 print:p-0"
      >
        <h1 className="text-2xl font-bold print:text-4xl">{salon.name}</h1>
        <p className="mt-2 text-lg font-medium print:text-2xl">Scan to get your queue token</p>
        <p className="text-base text-gray-700 print:text-xl">QR स्कैन करें, अपना टोकन नंबर पाएं</p>

        <div className="mx-auto mt-5 w-full max-w-xs print:max-w-md">
          <QRCodeSVG
            value={url}
            size={512}
            level="M"
            marginSize={2}
            title={`QR code for ${salon.name}`}
            className="h-auto w-full"
          />
        </div>

        <ol className="mx-auto mt-5 max-w-xs space-y-1 text-left text-sm text-gray-700 print:max-w-md print:text-lg">
          <li>1. Open your phone camera and scan</li>
          <li>2. Get your token number instantly</li>
          <li>3. Follow your turn on your phone</li>
        </ol>
        <p className="mt-3 text-xs text-gray-600 print:text-sm">No app. No sign-up.</p>
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
