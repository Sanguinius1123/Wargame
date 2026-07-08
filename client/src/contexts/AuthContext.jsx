import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);
const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

// Derives the internal email Supabase uses for username-based accounts.
// Must match the server-side toEmail() function in auth.js.
function toEmail(username) {
  return `${username.toLowerCase().replace(/[^a-z0-9._-]/g, '')}@wargame.local`;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) { setProfile(null); return; }
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => setProfile(data));
  }, [session]);

  // Sign in with username + password via the server (which derives the Supabase email)
  async function signIn(username, password) {
    const r = await fetch(`${SERVER}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await r.json();
    if (!r.ok) return { error: { message: data.error ?? 'Sign in failed' } };

    // Set the session on the Supabase client so all subsequent queries are authenticated
    const { error } = await supabase.auth.setSession({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
    });
    return { error };
  }

  // Legacy email-based sign-in (used for the GM's real email account during transition)
  async function signInWithEmail(email, password) {
    return supabase.auth.signInWithPassword({ email, password });
  }

  const signOut = () => supabase.auth.signOut();

  return (
    <AuthContext.Provider value={{ session, profile, signIn, signInWithEmail, signOut, loading: session === undefined }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
