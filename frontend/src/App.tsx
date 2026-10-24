// frontend/src/App.tsx
import { Routes, Route, Link } from 'react-router-dom';
import PageShell from './components/PageShell';import HomePage from './pages/HomePage';
import HealthPage from './pages/HealthPage';
import SalonList from './pages/SalonList';
import SalonDetails from './pages/SalonDetails';
import JoinQueue from './pages/JoinQueue';
import QueueTracking from './pages/QueueTracking';
import BarberLogin from './pages/BarberLogin';
import BarberDashboard from './pages/BarberDashboard';
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
      <Route path="/" element={<HomePage />} />
      <Route path="/health" element={<HealthPage />} />
      <Route path="/salons" element={<SalonList />} />
      <Route path="/salons/:salonId" element={<SalonDetails />} />
      <Route path="/salons/:salonId/join" element={<JoinQueue />} />
      <Route path="/tickets/:ticketId" element={<QueueTracking />} />
      <Route path="/barber/login" element={<BarberLogin />} />
      <Route path="/barber/dashboard" element={<BarberDashboard />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default App;