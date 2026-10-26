// frontend/src/pages/ScanHome.tsx
// Home screen while customer discovery is switched off: customers reach their ticket by scanning the salon's QR code.
import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell';
import ResumeTicketBanner from '../components/ResumeTicketBanner';

export default function ScanHome() {
  return (
    <PageShell title="Scan to get your token">
      <ResumeTicketBanner />
      <div className="flex min-h-[70dvh] flex-col justify-center text-center">
        <h1 className="text-3xl font-bold">Scan the QR code at the salon</h1>
        <p className="mt-3 text-gray-600">
          Open your phone's camera and point it at the salon's QR code. You'll get your token number
          straight away and can follow your turn here.
        </p>
        <p className="mt-2 text-gray-600">सैलून पर लगे QR कोड को स्कैन करें और अपना टोकन नंबर पाएं।</p>
        <p className="mt-4 text-sm text-gray-600">
          No account needed. We don't ask for your name or phone number.
        </p>
        <Link to="/barber/login" className="mt-10 inline-block min-h-11 py-2 text-sm text-gray-600 underline">
          Salon staff sign in
        </Link>
      </div>
    </PageShell>
  );
}
