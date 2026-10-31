import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HostCtx } from '../lib/dc';
// @ts-expect-error: screens are plain JSX
import Dashboard from './Dashboard';

const iso = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
const hist = (b: number) => Array.from({ length: 12 }, () => b);

const full = {
  me: { id: 'u1', name: 'Alex Morgan', initials: 'AM', theme: 'lilac', mode: 'light', prefs: {}, readAlerts: [] },
  household: { id: 'h1', name: 'Home' }, households: [],
  lenders: [{ id: 'l1', name: 'Harbour Bank', phone: '13 22 22', icon: '' }],
  brokers: [{ id: 'b1', name: 'Sam Lee', company: 'Lee Finance', loans: ['n1'], reviewOn: true, lastReview: iso(-170), every: 6, phone: '0400 000 000' }],
  loans: [
    { id: 'n1', name: 'Home Loan', lender: 'Harbour Bank', slot: 'a1', bal: 400000, orig: 500000, pEnd: 2050, payoff: 'Mar 2050', next: new Date().toISOString(), tone: 'good', status: 'On schedule',
      splits: [{ id: 's1', name: 'Variable', kind: 'variable', bal: 300000, rate: 6 }, { id: 's2', name: 'Fixed', kind: 'fixed', bal: 100000, rate: 5.5, fixedUntil: iso(40) }] }
  ],
  archivedLoans: [],
  accounts: [{ id: 'a1', name: 'Everyday', lender: 'Harbour Bank', type: 'Everyday', slot: 'a2', balance: 50000, hist: hist(50000), link: 'n1' },
    { id: 'a2', name: 'Savings', lender: 'Harbour Bank', type: 'Savings', slot: 'a3', balance: 10000, hist: hist(10000), link: null }],
  closedAccounts: [],
  statements: [{ id: 't1', splitId: 's1', accountId: null, end: iso(-20), status: 'Needs attention', importedAt: new Date().toISOString(), importedBy: 'Alex Morgan', deletedAt: '' },
    { id: 't2', splitId: null, accountId: 'a1', end: iso(-20), status: 'Reconciled', importedAt: new Date(Date.now() - 1000).toISOString(), importedBy: '', deletedAt: '' }],
  layouts: [],
  notifications: [{ id: 'x1', title: 'Rate review due', tag: 'Due', tagStyle: '', text: 'Sam Lee was last asked months ago.', when: 'In 3 days', href: '/settings' }]
};

const render = (data: unknown) => renderToStaticMarkup(React.createElement(HostCtx.Provider, { value: { data, act: async () => null, reload: async () => null } }, React.createElement(Dashboard)));

describe('dashboard', () => {
  it('shows the household overview', () => {
    const html = render(full);
    expect(html).toContain('Alex');
    expect(html).toContain('$350,000 owing after offsets.');
    expect(html).toContain('20% repaid so far. Debt-free by Mar 2050');
    expect(html).toContain('$60,000');
    expect(html).toContain('$50,000 offsetting a loan');
    for (const t of ['Rate review due', 'Fixed rate ending', 'Statements to review', 'Home Loan', 'Offsets Home Loan', 'Recent Statements', 'Home Loan · Variable', 'Sam Lee', 'Contacts'])
      expect(html, t).toContain(t);
    expect(html).not.toContain('Welcome to Folio');
  });
  it('shows a first-run welcome with no loans or accounts', () => {
    const html = render({ ...full, loans: [], accounts: [], statements: [], notifications: [], brokers: [] });
    expect(html).toContain('Welcome to Folio');
    for (const t of ['Add a loan', 'Add an account', 'Import a statement']) expect(html, t).toContain(t);
    expect(html).not.toContain('Needs Attention');
  });
  it('the bell shows the number of unread alerts, or just a dot when chosen in Profile', () => {
    const count = render(full);
    expect(count).toContain('aria-label="Notifications, 1 unread"');
    expect(count).toMatch(/<span class="badge">1<\/span>/);
    const dot = render({ ...full, me: { ...full.me, prefs: { bellStyle: 'dot' } } });
    expect(dot).toMatch(/<span class="badge dot"><\/span>/);
    expect(dot).toContain('aria-label="Notifications, 1 unread"'); // still said aloud
    expect(render({ ...full, notifications: [] })).toContain('aria-label="Notifications"');
  });
  it('the logo goes to the dashboard and the nav item is desktop only', () => {
    const html = render(full);
    expect(html).toMatch(/<li class="hide-m"><a class="navlink on" href="\/">/);
    expect(html.match(/href="\/" aria-label="Folio home"/g)).toHaveLength(2);
  });
});
