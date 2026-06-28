import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

const s = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0f1a' },
  card: { background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: 32, width: 360 },
  h1:   { color: '#e2e8f0', fontSize: 22, fontWeight: 700, marginBottom: 24, textAlign: 'center' },
  tab:  { display: 'flex', marginBottom: 20, borderBottom: '1px solid #1e293b' },
  tabBtn: (active) => ({ flex: 1, padding: '8px 0', background: 'none', border: 'none', color: active ? '#60a5fa' : '#64748b', cursor: 'pointer', borderBottom: active ? '2px solid #60a5fa' : '2px solid transparent', fontWeight: active ? 600 : 400 }),
  label: { display: 'block', color: '#94a3b8', fontSize: 13, marginBottom: 4 },
  input: { width: '100%', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4, padding: '8px 10px', color: '#e2e8f0', fontSize: 14, marginBottom: 14, boxSizing: 'border-box' },
  btn:   { width: '100%', background: '#2563eb', border: 'none', borderRadius: 4, padding: '10px 0', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 15 },
  err:   { color: '#f87171', fontSize: 13, marginBottom: 12 },
  msg:   { color: '#4ade80', fontSize: 13, marginBottom: 12 },
};

export default function Login() {
  const [tab, setTab] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const nav = useNavigate();

  async function handleSignIn(e) {
    e.preventDefault();
    setErr(''); setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) return setErr(error.message);
    nav('/');
  }

  async function handleRegister(e) {
    e.preventDefault();
    setErr(''); setMsg(''); setLoading(true);
    const r = await fetch(`${SERVER}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, username, registrationCode: code }),
    });
    const data = await r.json();
    setLoading(false);
    if (!r.ok) return setErr(typeof data.error === 'string' ? data.error : JSON.stringify(data.error) || 'Registration failed');
    setMsg('Check your email to confirm your account.');
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.h1}>Wargame</h1>
        <div style={s.tab}>
          <button style={s.tabBtn(tab === 'signin')}  onClick={() => setTab('signin')}>Sign In</button>
          <button style={s.tabBtn(tab === 'register')} onClick={() => setTab('register')}>Register</button>
        </div>

        {err && <p style={s.err}>{err}</p>}
        {msg && <p style={s.msg}>{msg}</p>}

        {tab === 'signin' ? (
          <form onSubmit={handleSignIn}>
            <label style={s.label}>Email</label>
            <input style={s.input} type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            <label style={s.label}>Password</label>
            <input style={s.input} type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            <button style={s.btn} disabled={loading}>{loading ? 'Signing in…' : 'Sign In'}</button>
          </form>
        ) : (
          <form onSubmit={handleRegister}>
            <label style={s.label}>Username</label>
            <input style={s.input} value={username} onChange={e => setUsername(e.target.value)} required />
            <label style={s.label}>Email</label>
            <input style={s.input} type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            <label style={s.label}>Password</label>
            <input style={s.input} type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            <label style={s.label}>Registration Code</label>
            <input style={s.input} value={code} onChange={e => setCode(e.target.value)} required />
            <button style={s.btn} disabled={loading}>{loading ? 'Registering…' : 'Register'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
