import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell';
import ResumeTicketBanner from '../components/ResumeTicketBanner';

export default function HomePage() {
  return (
    <PageShell title="Find a salon">
      <ResumeTicketBanner />
      <div className="flex min-h-[70dvh] flex-col justify-center text-center">
        <h1 className="text-3xl font-bold">Know the queue before you go.</h1>
        <p className="mt-3 text-gray-600">
          See how long the wait is at salons near you, join the line from wherever you are,
          and head over when your turn is close.
        </p>
        <Link to="/salons" className="btn-primary mt-8">
          Find a salon near me
        </Link>
        <p className="mt-4 text-sm text-gray-600">
          We'll ask for your location to show nearby salons. No account needed: your name and
          number are used only for your place in line and are removed shortly after your visit.
        </p>
        <Link to="/barber/login" className="mt-10 inline-block min-h-11 py-2 text-sm text-gray-600 underline">
          Salon staff sign in
        </Link>
      </div>
    </PageShell>
  );
}