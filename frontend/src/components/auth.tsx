import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Field, Input, PageHeader } from './ui';
import { jsonBody, request } from '../lib/api';

type AuthResponse = { token?: string; user?: { id: string; email: string; role: string } };

export function AuthPage({ admin = false, initialMode = 'login' }: { admin?: boolean; initialMode?: 'login' | 'register' }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>(admin ? 'login' : initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const path = admin ? '/auth/admin/login' : mode === 'register' ? '/auth/register' : '/auth/login';
      const result = await request<AuthResponse>(path, jsonBody({ email, password, ...(mode === 'register' ? { name } : {}) }));
      if (result.token) sessionStorage.setItem('nyaya-token', result.token);
      sessionStorage.setItem('nyaya-user', JSON.stringify(result.user ?? { email, role: admin ? 'admin' : 'user' }));
      navigate(admin ? '/admin' : '/wallet');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  }

  return <div className="mx-auto max-w-lg"><PageHeader eyebrow={admin ? 'Restricted access' : 'Nyaya account'} title={admin ? 'Admin login' : mode === 'register' ? 'Create your account' : 'User login'} description={admin ? 'Sign in to manage listings, transfers, and settlements.' : 'Create an account to fund a wallet and select the AI you believe will perform best.'} /><Card><form onSubmit={submit} className="grid gap-4">{mode === 'register' && <Field label="Name"><Input value={name} onChange={event => setName(event.target.value)} required autoComplete="name" /></Field>}<Field label="Email"><Input type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="email" /></Field><Field label="Password"><Input type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={8} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} /></Field>{error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}<Button disabled={busy}>{busy ? 'Working…' : admin ? 'Login as admin' : mode === 'register' ? 'Register' : 'Login'}</Button></form>{!admin && <div className="mt-5 flex justify-between border-t border-line pt-4 text-sm text-muted-foreground">{mode === 'register' ? <span>Already registered?</span> : <span>Need an account?</span>}<button className="font-semibold text-primary" type="button" onClick={() => setMode(mode === 'register' ? 'login' : 'register')}>{mode === 'register' ? 'Login' : 'Register'}</button></div>}{!admin && <Link className="mt-4 block text-center text-sm font-semibold text-primary" to="/admin/login">Admin login</Link>}</Card></div>;
}

export function logout() {
  sessionStorage.removeItem('nyaya-token');
  sessionStorage.removeItem('nyaya-user');
}
