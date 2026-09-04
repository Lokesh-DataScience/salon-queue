import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import HealthPage from './pages/HealthPage';
import SalonList from './pages/SalonList';
import SalonDetails from './pages/SalonDetails';
import JoinQueue from './pages/JoinQueue';
import QueueTracking from './pages/QueueTracking';

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/health" element={<HealthPage />} />
      <Route path="/salons" element={<SalonList />} />
      <Route path="/salons/:salonId" element={<SalonDetails />} />
      <Route path="/salons/:salonId/join" element={<JoinQueue />} />
      <Route path="/tickets/:ticketId" element={<QueueTracking />} />
    </Routes>
  );
}

export default App;