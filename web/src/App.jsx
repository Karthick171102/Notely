import { Routes, Route, Navigate } from 'react-router-dom';
import { getToken } from './api.js';
import Login from './pages/Login.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import Inbox from './pages/Inbox.jsx';
import Integrations from './pages/Integrations.jsx';

function RequireAuth({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><Projects /></RequireAuth>} />
      <Route path="/inbox" element={<RequireAuth><Inbox /></RequireAuth>} />
      <Route path="/integrations" element={<RequireAuth><Integrations /></RequireAuth>} />
      <Route path="/projects/:id" element={<RequireAuth><ProjectDetail /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
