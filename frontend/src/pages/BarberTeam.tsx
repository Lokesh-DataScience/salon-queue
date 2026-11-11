// frontend/src/pages/BarberTeam.tsx
// Hidden, not deleted: the route exists, but Settings only links here when VITE_MULTI_BARBER=true.
import PageShell from '../components/PageShell';
import BackLink from '../components/BackLink';
import TeamSection from '../components/TeamSection';

export default function BarberTeam() {
  return (
    <PageShell title="Barbers">
      <BackLink />
      <TeamSection asPage />
    </PageShell>
  );
}
