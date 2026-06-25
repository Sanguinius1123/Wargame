import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function ProtectedRoute({ children, requireGM = false }) {
  const { session, profile, loading } = useAuth();

  if (loading) return <p style={{ color: '#94a3b8', padding: 24 }}>Loading…</p>;
  if (!session) return <Navigate to="/login" replace />;
  if (requireGM && profile?.global_role !== 'gm') return <Navigate to="/" replace />;

  return children;
}
