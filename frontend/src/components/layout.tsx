import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Button } from './ui';
import { logout } from './auth';

const links = [['/', 'Overview'], ['/market', 'Predictions'], ['/investigations', 'Investigations'], ['/jurors', 'Jurors'], ['/wallet', 'Wallet']];
export function Layout() {
  const [dark, setDark] = useState(() => localStorage.getItem('nyaya-theme') === 'dark' || (!localStorage.getItem('nyaya-theme') && matchMedia('(prefers-color-scheme: dark)').matches));
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const signedIn = Boolean(sessionStorage.getItem('nyaya-token'));
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); localStorage.setItem('nyaya-theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => setOpen(false), [location.pathname]);
  return <div className="min-h-screen bg-canvas text-ink"><header className="sticky top-0 z-20 border-b border-line/80 bg-canvas/95 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8"><NavLink to="/" className="flex items-center gap-3 font-bold tracking-tight"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-lg text-primary-foreground">N</span><span>Nyaya<span className="text-primary">.</span></span></NavLink><button aria-label="Toggle navigation" className="rounded-lg p-2 text-ink md:hidden" onClick={() => setOpen(!open)}>☰</button><nav className={`${open ? 'absolute left-4 right-4 top-16 grid gap-1 rounded-2xl border border-line bg-panel p-3 shadow-soft' : 'hidden'} md:flex md:items-center md:gap-1`}>{links.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-ink'}`}>{label}</NavLink>)}</nav><div className="hidden items-center gap-2 md:flex"><span className="hidden text-xs text-muted-foreground lg:inline">Hedera testnet</span>{signedIn ? <Button variant="secondary" className="!min-h-9 !px-3" onClick={() => { logout(); window.location.href = '/'; }}>Logout</Button> : <><NavLink className="text-sm font-semibold text-primary" to="/login">Login</NavLink><NavLink className="text-sm font-semibold text-primary" to="/register">Register</NavLink></>}<Button variant="secondary" className="!min-h-9 !px-3" aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`} onClick={() => setDark(!dark)}>{dark ? '☀' : '☾'}</Button></div></div></header><main className="mx-auto max-w-7xl px-5 py-8 lg:px-8 lg:py-12"><Outlet /></main><footer className="mx-auto max-w-7xl border-t border-line px-5 py-6 text-xs text-muted-foreground lg:px-8">Nyaya · AI jurors, independently accountable.</footer></div>;
}
