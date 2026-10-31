'use client';
import React from 'react';
import { HostCtx } from '../lib/dc';
import Dashboard from '../screens/Dashboard';
import Loans from '../screens/Loans';
import Main from '../screens/Main';
import Setup from '../screens/Setup';
import Accounts from '../screens/Accounts';
import AddAccount from '../screens/AddAccount';
import Statements from '../screens/Statements';
import Settings from '../screens/Settings';
import Profile from '../screens/Profile';

const SCREENS = { Dashboard, Loans, Main, Setup, Accounts, AddAccount, Statements, Settings, Profile };

/**
 * @param {{ name: string, params?: Record<string, string> }} props
 */
// Loads the signed-in person's data once, then renders a screen. Actions post to /api/act and reload.
export default function ScreenHost({ name, params }) {
  const [data, setData] = React.useState(null);
  const [err, setErr] = React.useState('');
  const load = React.useCallback(async () => {
    try {
      const r = await fetch('/api/state' + (params ? '?' + new URLSearchParams(params) : ''), { cache: 'no-store' });
      if (r.status === 401) { window.location.href = '/signin'; return null; }
      const j = await r.json();
      try { if (j.me) window.localStorage.setItem('loanLookTheme', JSON.stringify({ themeId: j.me.theme, mode: j.me.mode })); } catch (e) {}
      setData(j);
      return j;
    } catch (e) { setErr('Folio could not reach its server.'); return null; }
  }, [params]);
  React.useEffect(() => { load(); }, [load]);
  // Clicking outside a dropdown (the Add and three-dot menus, and notifications) closes it, and so does Escape.
  // Their own see-through backdrops cannot always cover the page: the blurred top bar and moving cards confine them.
  const screenRef = React.useRef(null);
  React.useEffect(() => {
    const MENUS = 'details.plus[open], details.dots[open]';
    const closeNotifs = () => { const s = screenRef.current; if (s && s.state && s.state.notifsOpen) s.setState({ notifsOpen: false }); };
    const onClick = (e) => {
      const t = e.target;
      document.querySelectorAll(MENUS).forEach((d) => { if (!d.contains(t)) d.removeAttribute('open'); });
      if (!(t && t.closest && t.closest('.panel, .bell'))) closeNotifs();
    };
    const onKey = (e) => { if (e.key !== 'Escape') return; document.querySelectorAll(MENUS).forEach((d) => d.removeAttribute('open')); closeNotifs(); };
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick, true); document.removeEventListener('keydown', onKey); };
  }, []);
  const act = React.useCallback(async (kind, payload, opts) => {
    const r = await fetch('/api/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, payload: payload || {} }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { window.location.href = '/signin'; return null; }
    if (!r.ok) throw new Error(j.error || 'That did not work. Try again.');
    if (!opts || opts.reload !== false) await load();
    return j;
  }, [load]);
  const Screen = SCREENS[name];
  if (err) return <div className="boot">{err}</div>;
  if (!data) return <div className="boot">Loading…</div>;
  return (
    <HostCtx.Provider value={{ data, act, reload: load, params: params || {} }}>
      <Screen ref={screenRef} />
    </HostCtx.Provider>
  );
}
