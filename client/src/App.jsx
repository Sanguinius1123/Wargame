import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Login     from './pages/Login';
import GameList  from './pages/GameList';
import GameView  from './pages/GameView';
import GMDashboard from './pages/GMDashboard';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><GameList /></ProtectedRoute>} />
      <Route path="/game/:gameId" element={<ProtectedRoute><GameView /></ProtectedRoute>} />
      <Route path="/game/:gameId/gm" element={<ProtectedRoute requireGM><GMDashboard /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
