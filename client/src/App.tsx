import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Shell from './components/Shell';
import LoginPage from './pages/LoginPage';
import ProjectsPage from './pages/ProjectsPage';
import SchedulePage from './pages/SchedulePage';
import PeoplePage from './pages/PeoplePage';
import AccountPage from './pages/AccountPage';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="center-note">
        <div className="spinner" />
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<SchedulePage />} />
        <Route path="/account" element={<AccountPage />} />
        {user.role === 'pm' && <Route path="/people" element={<PeoplePage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
