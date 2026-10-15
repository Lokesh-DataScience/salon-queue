// frontend/src/App.tsx
import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import HealthPage from './pages/HealthPage';
import SalonList from './pages/SalonList';
import SalonDetails from './pages/SalonDetails';
import JoinQueue from './pages/JoinQueue';
import QueueTracking from './pages/QueueTracking';
import BarberLogin from './pages/BarberLogin';
import BarberDashboard from './pages/BarberDashboard';

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
    </Routes>
  );
}

export default App;