// frontend/src/pages/BarberServices.tsx
import { useLocation } from 'react-router-dom';
import PageShell from '../components/PageShell';
import BackLink from '../components/BackLink';
import ServicesSection from '../components/ServicesSection';

export default function BarberServices() {
  // Set right after registering: shows the "Done, show my QR code" prompt.
  const welcome = Boolean((useLocation().state as { welcome?: boolean } | null)?.welcome);

  return (
    <PageShell title="Services">
      <BackLink />
      <ServicesSection welcome={welcome} asPage />
    </PageShell>
  );
}
