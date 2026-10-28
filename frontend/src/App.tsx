// frontend/src/App.tsx
import { Routes, Route, Link, Navigate } from 'react-router-dom';
import PageShell from './components/PageShell';
import HomePage from './pages/HomePage';
import ScanHome from './pages/ScanHome';
import ScanLanding from './pages/ScanLanding';
import HealthPage from './pages/HealthPage';
import SalonList from './pages/SalonList';
import SalonDetails from './pages/SalonDetails';
import JoinQueue from './pages/JoinQueue';
import QueueTracking from './pages/QueueTracking';
import BarberLogin from './pages/BarberLogin';
import BarberDashboard from './pages/BarberDashboard';
import BarberQr from './pages/BarberQr';
import BarberRegister from './pages/BarberRegister';
import BarberOffers from './pages/BarberOffers';
import { CUSTOMER_DISCOVERY } from './lib/features';

function NotFound() {
  return (
    <PageShell title="Page not found">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-gray-600">That page doesn't exist.</p>
      <Link to="/" className="btn-secondary mt-6">Go to home</Link>
    </PageShell>
  );
}

function App() {
  return (
    <Routes>
      {CUSTOMER_DISCOVERY ? (
        <>
          <Route path="/" element={<HomePage />} />
          <Route path="/salons" element={<SalonList />} />
          <Route path="/salons/:salonId" element={<SalonDetails />} />
          <Route path="/salons/:salonId/join" element={<JoinQueue />} />
        </>
      ) : (
        <>
          <Route path="/" element={<ScanHome />} />
          {/* Hidden, not deleted: the pages are still in the code, just not reachable. */}
          <Route path="/salons/*" element={<Navigate to="/" replace />} />
        </>
      )}
      <Route path="/q/:code" element={<ScanLanding />} />
      <Route path="/health" element={<HealthPage />} />
      <Route path="/tickets/:ticketId" element={<QueueTracking />} />
      <Route path="/barber/login" element={<BarberLogin />} />
      <Route path="/barber/register" element={<BarberRegister />} />
      <Route path="/barber/dashboard" element={<BarberDashboard />} />
      <Route path="/barber/qr" element={<BarberQr />} />
      <Route path="/barber/offers" element={<BarberOffers />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default App;
