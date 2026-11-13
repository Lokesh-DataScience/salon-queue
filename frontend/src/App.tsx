// frontend/src/App.tsx
import { useEffect } from 'react';
import { Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
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
import BarberSettings from './pages/BarberSettings';
import BarberLayout from './components/BarberLayout';
import BarberStats from './pages/BarberStats';
import BarberCustomers from './pages/BarberCustomers';
import BarberProfile from './pages/BarberProfile';
import BarberServices from './pages/BarberServices';
import BarberTeam from './pages/BarberTeam';
import BarberAdmin from './pages/BarberAdmin';
import BarberReport from './pages/BarberReport';
import MySalons from './pages/MySalons';
import SalonQueue from './pages/SalonQueue';
import MyTickets from './pages/MyTickets';
import ScanQr from './pages/ScanQr';
import VisitHistory from './pages/VisitHistory';
import CustomerChrome from './components/CustomerChrome';
import { applyManifest } from './lib/appManifest';

function NotFound() {
  return (
    <PageShell title="Page not found">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-gray-600">That page doesn't exist.</p>
      <Link to="/" className="btn-secondary mt-6">Go to home</Link>
    </PageShell>
  );
}

// Barber pages offer the barber app for install; every customer page offers the customer app.
function ManifestSwitch() {
  const { pathname } = useLocation();
  useEffect(() => applyManifest(pathname), [pathname]);
  return null;
}

function App() {
  return (
    <>
    <ManifestSwitch />
    <CustomerChrome />
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
      {/* Customer app: only salons this phone has scanned. */}
      <Route path="/c" element={<MySalons />} />
      <Route path="/c/tokens" element={<MyTickets />} />
      <Route path="/c/scan" element={<ScanQr />} />
      <Route path="/c/history" element={<VisitHistory />} />
      <Route path="/c/s/:code" element={<SalonQueue />} />
      <Route path="/c/s/:code/join" element={<ScanLanding source="app" />} />
      <Route path="/barber/login" element={<BarberLogin />} />
      <Route path="/barber/register" element={<BarberRegister />} />
      <Route element={<BarberLayout />}>
        <Route path="/barber/dashboard" element={<BarberDashboard />} />
        <Route path="/barber/stats" element={<BarberStats />} />
        <Route path="/barber/settings" element={<BarberSettings />} />
        <Route path="/barber/settings/profile" element={<BarberProfile />} />
        <Route path="/barber/settings/services" element={<BarberServices />} />
        <Route path="/barber/settings/team" element={<BarberTeam />} />
        <Route path="/barber/qr" element={<BarberQr />} />
        <Route path="/barber/offers" element={<BarberOffers />} />
        <Route path="/barber/customers" element={<BarberCustomers />} />
        <Route path="/barber/admin" element={<BarberAdmin />} />
        <Route path="/barber/report" element={<BarberReport />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
    </>
  );
}

export default App;
