import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HostCtx } from '../lib/dc';
// @ts-expect-error: screens are plain JSX
import Settings from './Settings';
// @ts-expect-error: screens are plain JSX
import Lenders from './Lenders';
// @ts-expect-error: screens are plain JSX
import Brokers from './Brokers';
// @ts-expect-error: screens are plain JSX
import Profile from './Profile';

const data = (admin = false) => ({
  me: { id: 'u1', name: 'Alex', initials: 'A', theme: 'lilac', mode: 'light', prefs: {}, readAlerts: [], isAdmin: admin, canManage: true, sessions: [] },
  household: { id: 'h1', name: 'Home' }, households: [], members: [], removedMembers: [], invites: [],
  lenders: [{ id: 'len1', name: 'Harbour Bank' }], brokers: [{ id: 'bro1', name: 'Sam Lee', loans: [] }],
  deletedLenders: [], deletedBrokers: [], loans: [], archivedLoans: [], accounts: [], closedAccounts: [], statements: [], layouts: [], notifications: [], channels: [], settings: {}
});

// a stand-in for the browser's address bar and history
function fakeBrowser(hash: string) {
  const loc = { pathname: '/settings', search: '', hash, host: 'localhost:3000', hostname: 'localhost', origin: 'http://localhost:3000', protocol: 'http:', href: 'http://localhost:3000/settings' + hash };
  const calls: string[] = [];
  const store: Record<string, string> = {};
  const listeners: Record<string, () => void> = {};
  (globalThis as any).window = {
    location: loc,
    history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => { calls.push('replace ' + url); loc.hash = url.slice(url.indexOf('#')); }, pushState: () => calls.push('push') },
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } },
    addEventListener: (k: string, f: () => void) => { listeners[k] = f; }, removeEventListener: () => {}, scrollY: 0
  };
  (globalThis as any).document = { documentElement: { scrollTop: 0 } };
  return { loc, calls, store, listeners };
}

// mounts a screen without a DOM: build it, then run componentDidMount with a setState that, like React, calls componentDidUpdate
function mount(d: unknown, Screen: any = Settings, props: object = {}) {
  const ctx = { data: d, act: async () => null, reload: async () => null };
  const s: any = new Screen(props, ctx);
  s.context = ctx;
  s.state = s.state || {};
  s.setState = (u: object | ((p: object) => object)) => { const prev = s.state; s.state = { ...prev, ...(typeof u === 'function' ? u(prev) : u) }; if (s.componentDidUpdate) s.componentDidUpdate(props, prev); };
  s.componentDidMount();
  return s;
}
const tabOn = (s: any) => s.renderVals().tabs.find((t: any) => t.on).title;
const html = (d: unknown, tab: string) => renderToStaticMarkup(React.createElement(HostCtx.Provider, { value: { data: d, act: async () => null, reload: async () => null } }, React.createElement(Settings, { tab })));

afterEach(() => { delete (globalThis as any).window; delete (globalThis as any).document; });

describe('settings tabs in the address', () => {
  it('opens the tab named after #', () => {
    fakeBrowser('#brokers');
    expect(tabOn(mount(data()))).toBe('Brokers');
  });
  it('writes the tab to the address when you switch, without adding history', () => {
    const b = fakeBrowser('');
    const s = mount(data());
    s.renderVals().tabs.find((t: any) => t.title === 'Lenders').pick();
    expect(b.loc.hash).toBe('#lenders');
    expect(b.calls).toEqual(['replace /settings#lenders']);
    expect(tabOn(s)).toBe('Lenders');
  });
  it('keeps a lender or broker link and opens its tab', () => {
    const b = fakeBrowser('#len1');
    b.store.folioOpen = JSON.stringify({ kind: 'lender', id: 'len1', t: Date.now() });
    const s = mount(data());
    expect(tabOn(s)).toBe('Lenders');
    expect(b.loc.hash).toBe('#len1');
    fakeBrowser('#bro1');
    expect(tabOn(mount(data()))).toBe('Brokers');
  });
  it('a tab sent from another page is written to the address', () => {
    const b = fakeBrowser('');
    b.store.folioOpen = JSON.stringify({ kind: 'settings', tab: 'layouts', t: Date.now() });
    expect(tabOn(mount(data()))).toBe('Layouts');
    expect(b.loc.hash).toBe('#layouts');
  });
  it('ignores unknown names, and Server for people who are not admins', () => {
    fakeBrowser('#nonsense');
    expect(tabOn(mount(data()))).toBe('Household');
    fakeBrowser('#server');
    expect(tabOn(mount(data(false)))).toBe('Household');
    fakeBrowser('#server');
    expect(tabOn(mount(data(true)))).toBe('Server');
  });
  it('follows the address when it changes by hand', () => {
    const b = fakeBrowser('#household');
    const s = mount(data());
    b.loc.hash = '#data';
    b.listeners.hashchange();
    expect(tabOn(s)).toBe('Data and privacy');
  });
  it('an open lender or broker is kept in the address, and the list when you close it', () => {
    for (const [Screen, id, list] of [[Lenders, 'len1', '#lenders'], [Brokers, 'bro1', '#brokers']] as const) {
      const b = fakeBrowser(list);
      const s = mount(data(), Screen, { embedded: 'true' });
      s.renderVals().cards[0].view();
      expect(b.loc.hash, list).toBe('#' + id);
      s.renderVals().closeView();
      expect(b.loc.hash, list).toBe(list);
      expect(b.calls.every((c) => c.startsWith('replace ')), list).toBe(true);
      // a refresh on the open one comes back to it, on the right tab
      fakeBrowser('#' + id);
      expect(mount(data(), Screen, { embedded: 'true' }).state.viewId, list).toBe(id);
      expect(tabOn(mount(data())), list).toBe(list === '#lenders' ? 'Lenders' : 'Brokers');
    }
  });
  it('layout cards have New version and Export buttons instead of a menu', () => {
    const lay = { id: 'ly1', name: 'Harbour PDF', lenderName: 'Harbour Bank', lender: 'len1', kind: 'loan', fmt: 'PDF', status: 'ok', failed: '', usedHidden: false, lastMatch: '', used: [['Home Loan', 3]], deletedAt: '',
      versions: [{ id: 'v1', n: 1, date: '1 Oct 2026', by: 'Alex', map: {} }], map: {} };
    const out = html({ ...data(), layouts: [lay] }, 'layouts');
    expect(out).toContain('Harbour PDF');
    expect(out).toContain('aria-label="New version Harbour PDF"');
    expect(out).toContain('aria-label="Export Harbour PDF"');
    expect(out).not.toContain('Options for Harbour PDF');
    expect(html({ ...data(), layouts: [{ ...lay, status: 'remap' }] }, 'layouts')).toContain('aria-label="Re-map Harbour PDF"');
  });
  it("shows your own security log in Profile's Recent Activity", () => {
    const d = data();
    const me = { ...d.me, sessions: [], securityLog: [{ id: 'e1', kind: 'password_changed', at: '2026-10-31T09:00:00.000Z', ip: '192.168.7.42', title: 'Password changed', detail: '1 other device signed out' }] };
    const out = renderToStaticMarkup(React.createElement(HostCtx.Provider, { value: { data: { ...d, me }, act: async () => null, reload: async () => null } }, React.createElement(Profile)));
    expect(out).toContain('Recent Activity');
    expect(out).toContain('Password changed');
    expect(out).toContain('1 other device signed out');
    expect(out).toContain('192.168.7.42');
  });
  it("shows the server's security log on the admin's Server tab", () => {
    const log = [
      { id: 'e1', kind: 'signin_failed', at: '2026-10-31T09:00:00.000Z', ip: '203.0.113.9', title: 'Wrong password when signing in', detail: 'For alex@folio.local', who: 'Alex' },
      { id: 'e2', kind: 'backup', at: '2026-10-31T02:00:00.000Z', ip: '', title: 'Backup made', detail: 'Automatic: folio-backup.folio', who: '' }
    ];
    const admin = { ...data(true), server: { backups: [], securityLog: log, backupSettings: { auto: true, freq: 'daily', keep: 7, folder: './backups', remind: false } } };
    const out = html(admin, 'server');
    expect(out).toContain('Security Log');
    expect(out).toContain('Wrong password when signing in');
    expect(out).toContain('For alex@folio.local');
    expect(out).toContain('203.0.113.9');
    expect(out).toMatch(/color:var\(--danger\)[^>]*>Wrong password when signing in/);
    expect(html({ ...admin, server: { ...admin.server, securityLog: [] } }, 'server')).toContain('Nothing recorded yet.');
  });
  it('still renders each tab', () => {
    for (const t of ['household', 'notify', 'layouts', 'lenders', 'brokers', 'data']) expect(html(data(), t).length, t).toBeGreaterThan(1000);
  });
});
