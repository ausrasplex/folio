'use client';
// Runtime for screens generated from the mockup boards (tools/convert.py).
import React from 'react';

export const HostCtx = React.createContext({ data: null, act: async () => null, reload: async () => null });

// Base class: the mockup logic classes used DCLogic, which behaves like a React class component.
export class DCBase extends React.Component {
  static contextType = HostCtx;
  constructor(props, context) {
    super(props, context);
    const me = context && context.data && context.data.me;
    this.state = me ? { themeId: me.theme || 'lilac', mode: me.mode || 'light' } : {};
  }
  get data() { return (this.context && this.context.data) || {}; }
  act(kind, payload, opts) { return this.context.act(kind, payload, opts); }
  /** Runs an action and shows its error (or a message) in the screen's toast when it has one. */
  async run(kind, payload, okMsg) {
    try { const r = await this.act(kind, payload); if (okMsg && this.flash) this.flash(okMsg); return r; }
    catch (e) { if (this.flash) this.flash(e.message); else if (typeof window !== 'undefined') window.alert(e.message); return null; }
  }
  /** Downloads an image from a pasted link (through the server) as a Blob, ready for the screen's readImage. */
  async linkImage(url) {
    let r;
    try { r = await fetch('/api/image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) }); }
    catch (e) { throw new Error('Folio could not reach the server'); }
    if (!r.ok) { let m = 'That image could not be downloaded'; try { m = (await r.json()).error || m; } catch (e) {} throw new Error(m); }
    return r.blob();
  }
  saveThemeServer(theme, mode) { try { this.act('theme', { theme, mode }, { reload: false }); } catch (e) {} }
  /** Values every screen shares: you, the household and the alerts. Merged over each screen's own values. */
  common() {
    const d = this.data; const me = d.me || {}; const st = this.state || {};
    const read = (me.readAlerts || []);
    const notifs = (d.notifications || []).map((n) => {
      const unread = read.indexOf(n.id) < 0;
      return Object.assign({}, n, { dot: unread ? 'background:var(--primary)' : 'background:transparent',
        open: () => { if (n.fo) { try { window.localStorage.setItem('folioOpen', JSON.stringify(Object.assign({ t: Date.now() }, n.fo))); } catch (e) {} } this.act('alertsRead', { ids: [n.id] }, { reload: false }); } });
    });
    const unreadCount = notifs.filter((n) => read.indexOf(n.id) < 0).length;
    return {
      meIni: me.initials || '?', mePhotoSt: me.photo ? ";background:var(--a1) url('" + me.photo + "') center/cover no-repeat;color:transparent" : '',
      hhLabel: (d.household && d.household.name) || 'Household',
      notifs, unreadCount, hasUnread: unreadCount > 0, allRead: unreadCount === 0, noNotifs: notifs.length === 0,
      notifsOpen: !!st.notifsOpen, toggleNotifs: () => this.setState({ notifsOpen: !st.notifsOpen }),
      markAll: () => this.act('alertsRead', { ids: notifs.map((n) => n.id) })
    };
  }
  notifRead() { return ((this.data.me || {}).readAlerts) || []; }
  notifMark(ids) { this.act('alertsRead', { ids }); }
  hhSaved() { return (this.data.household && this.data.household.name) || 'Household'; }
}

/** The household name in the header; opens a menu to switch when you belong to more than one. */
export function HouseholdSwitch({ style, chevron }) {
  const ctx = React.useContext(HostCtx);
  const [open, setOpen] = React.useState(false);
  const box = React.useRef(null);
  // Clicking anywhere outside closes it (a backdrop cannot cover the page from inside the blurred top bar), and so does Escape
  React.useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick, true); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const d = ctx.data || {};
  const all = d.households || [];
  return (
    <span ref={box} style={{ position: 'relative', display: 'inline-flex' }}>
      <button className="hbs" type="button" style={style} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{(d.household && d.household.name) || 'Household'} {chevron}</button>
      {open ? (
        <>
          <span role="menu" style={{ position: 'absolute', top: 50, left: 0, zIndex: 50, minWidth: 260, background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 20, padding: 8, boxShadow: '0 12px 32px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column' }}>
            <span style={{ padding: '8px 12px 4px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Your households</span>
            {all.map((h) => (
              <button key={h.id} type="button" role="menuitemradio" aria-checked={h.current} className="hhopt" onClick={async () => { setOpen(false); if (!h.current) { await ctx.act('switchHousehold', { id: h.id }); window.location.reload(); } }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '0 12px', border: 0, borderRadius: 12, background: h.current ? 'var(--surface2)' : 'transparent', color: 'var(--ink)', font: 'inherit', fontSize: 14, fontWeight: 600, textAlign: 'left', cursor: 'pointer' }}>
                <span style={{ flex: 1 }}>{h.name}</span><span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{h.role}</span>
              </button>
            ))}
            <span role="separator" style={{ height: 1, background: 'var(--line)', margin: '6px 4px' }} />
            <a href="/settings" className="hhopt" style={{ display: 'flex', alignItems: 'center', minHeight: 44, padding: '0 12px', borderRadius: 12, fontSize: 14, fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }}>Household settings</a>
          </span>
        </>
      ) : null}
    </span>
  );
}

/**
 * The app's date picker, used by every date field: a calendar with month and year choosers.
 * Its state lives on the screen as state.dp ({ key, ym: [year, month], view: days | months | years }), one open at a time.
 */
export function datePicker(screen, key, value, set) {
  const st = screen.state || {};
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (dt) => dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
  const now = new Date();
  const today = iso(now);
  const fmt = (v) => { if (!v) return ''; const p = String(v).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const p = String(value || today).split('-').map(Number);
  const dp = st.dp || {};
  const open = dp.key === key;
  const ym = open && dp.ym ? dp.ym : [p[0], p[1] - 1];
  const view = open && dp.view ? dp.view : 'days';
  const go = (o) => screen.setState({ dp: Object.assign({ key, ym, view }, o) });
  const cellSt = (sel, cur) => sel ? 'background:var(--primary);color:var(--primaryInk)' : cur ? 'box-shadow:inset 0 0 0 2px var(--sel)' : '';
  const first = new Date(ym[0], ym[1], 1), startDow = first.getDay(), dim = new Date(ym[0], ym[1] + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < Math.ceil((startDow + dim) / 7) * 7; i++) {
    const dn = i - startDow + 1; const dt = new Date(ym[0], ym[1], dn); const v = iso(dt); const sel = v === value; const inMonth = dn >= 1 && dn <= dim;
    cells.push({ d: String(dt.getDate()), sel, aria: dt.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      st: sel ? 'background:var(--primary);color:var(--primaryInk)' : (inMonth ? '' : 'color:var(--muted);opacity:.5') + (v === today ? ';box-shadow:inset 0 0 0 2px var(--sel)' : ''),
      pick: () => { set(v); screen.setState({ dp: null }); } });
  }
  const months = Array.from({ length: 12 }, (_, m) => {
    const d = new Date(2000, m, 1);
    return { t: d.toLocaleDateString('en-AU', { month: 'short' }), aria: d.toLocaleDateString('en-AU', { month: 'long' }) + ' ' + ym[0], sel: m === ym[1],
      st: cellSt(m === ym[1], m === now.getMonth() && ym[0] === now.getFullYear()), pick: () => go({ ym: [ym[0], m], view: 'days' }) };
  });
  // twelve years a page, in blocks that stay put while you browse (2016 to 2027, 2028 to 2039)
  const y0 = Math.floor(ym[0] / 12) * 12;
  const years = Array.from({ length: 12 }, (_, i) => {
    const y = y0 + i;
    return { t: String(y), aria: String(y), sel: y === ym[0], st: cellSt(y === ym[0], y === now.getFullYear()), pick: () => go({ ym: [y, ym[1]], view: 'days' }) };
  });
  const step = view === 'years' ? 12 : view === 'months' ? 1 : 0;
  return {
    open, label: fmt(value) || 'Choose a date', month: first.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }), cells,
    monthName: first.toLocaleDateString('en-AU', { month: 'long' }), year: String(ym[0]), yearsLabel: y0 + ' to ' + (y0 + 11),
    isDays: view === 'days', isMonths: view === 'months', isYears: view === 'years', months, years,
    showMonths: () => go({ view: view === 'months' ? 'days' : 'months' }),
    showYears: () => go({ view: view === 'years' ? 'days' : 'years' }),
    toggle: () => screen.setState({ dp: open ? null : { key, ym, view: 'days' } }),
    prevLabel: view === 'years' ? 'Earlier years' : view === 'months' ? 'Previous year' : 'Previous month',
    nextLabel: view === 'years' ? 'Later years' : view === 'months' ? 'Next year' : 'Next month',
    prev: () => go({ ym: step ? [ym[0] - step, ym[1]] : ym[1] === 0 ? [ym[0] - 1, 11] : [ym[0], ym[1] - 1] }),
    next: () => go({ ym: step ? [ym[0] + step, ym[1]] : ym[1] === 11 ? [ym[0] + 1, 0] : [ym[0], ym[1] + 1] }),
    today: () => { set(today); screen.setState({ dp: null }); }
  };
}

const chevron = (d) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The pop-up for a date field, drawn from datePicker()'s values. Shows nothing while closed. */
export function DatePop({ dp, label }) {
  if (!dp || !dp.open) return null;
  const grid = (list) => (
    <div className="dpgrid3">
      {list.map((o, i) => <button key={i} type="button" className="dpcell" style={css(o.st)} aria-label={o.aria} aria-pressed={o.sel} onClick={o.pick}>{o.t}</button>)}
    </div>
  );
  return (
    <div className="dp" role="dialog" aria-label={label || 'Choose a date'}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button type="button" className="iback" style={{ margin: 0 }} aria-label={dp.prevLabel} onClick={dp.prev}>{chevron('m15 18-6-6 6-6')}</button>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          <button type="button" className={'dphead' + (dp.isMonths ? ' on' : '')} aria-expanded={dp.isMonths} aria-label={'Choose the month, now ' + dp.monthName} onClick={dp.showMonths}>{dp.monthName}{chevron('m6 9 6 6 6-6')}</button>
          <button type="button" className={'dphead' + (dp.isYears ? ' on' : '')} aria-expanded={dp.isYears} aria-label={'Choose the year, now ' + dp.year} onClick={dp.showYears}>{dp.year}{chevron('m6 9 6 6 6-6')}</button>
        </span>
        <button type="button" className="iback" style={{ margin: 0 }} aria-label={dp.nextLabel} onClick={dp.next}>{chevron('m9 18 6-6-6-6')}</button>
      </div>
      {dp.isDays ? (
        <>
          <div className="dpgrid" aria-hidden="true" style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{WEEKDAYS.map((d) => <span key={d}>{d}</span>)}</div>
          <div className="dpgrid">{dp.cells.map((c, i) => <button key={i} type="button" className="dpday" style={css(c.st)} aria-label={c.aria} aria-pressed={c.sel} onClick={c.pick}>{c.d}</button>)}</div>
        </>
      ) : null}
      {dp.isMonths ? grid(dp.months) : null}
      {dp.isYears ? (<><span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textAlign: 'center' }}>{dp.yearsLabel}</span>{grid(dp.years)}</>) : null}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <button type="button" className="btn2" style={{ minHeight: 40, padding: '0 16px' }} onClick={dp.today}>Today</button>
        <button type="button" className="btn2" style={{ minHeight: 40, padding: '0 16px' }} onClick={dp.toggle}>Close</button>
      </div>
    </div>
  );
}

const cache = new Map();
// Inline style string -> React style object. Respects quotes and brackets (data: URLs contain ';').
export function css(str) {
  if (str == null || str === false) return undefined;
  const s = String(str);
  if (cache.has(s)) return cache.get(s);
  const out = {};
  let depth = 0, quote = '', buf = '';
  const flush = () => {
    const i = buf.indexOf(':');
    if (i > 0) {
      const k = buf.slice(0, i).trim();
      let val = buf.slice(i + 1).trim();
      let imp = false;
      if (/!important$/.test(val)) { val = val.replace(/\s*!important$/, ''); imp = true; }
      if (k) {
        const key = k.startsWith('--') ? k : k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()).replace(/^Ms/, 'ms');
        out[key] = val;
      }
      void imp;
    }
    buf = '';
  };
  for (const ch of s) {
    if (quote) { if (ch === quote) quote = ''; buf += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth <= 0) { flush(); continue; }
    buf += ch;
  }
  flush();
  if (cache.size > 5000) cache.clear();
  cache.set(s, out);
  return out;
}

// Mockup board links -> app routes (used for links built in the logic).
const ROUTES = { Dashboard: '/', Loans: '/loans', Main: '/loan', Setup: '/loans/new', Accounts: '/accounts', AddAccount: '/accounts/new', Statements: '/statements', Settings: '/settings', Profile: '/profile', Lenders: '/settings', Brokers: '/settings', Layouts: '/settings' };
export function R(href) {
  if (typeof href !== 'string') return href;
  const m = href.match(/^([A-Za-z]+)\.dc\.html(#.*)?$/);
  return m ? (ROUTES[m[1]] || '/') + (m[2] || '') : href;
}

/** Uploads one statement file for reading. With autoSave, it is saved straight away when its layout matches and the checks pass. */
export async function importFile(file, dest, autoSave) {
  const fd = new FormData();
  fd.append('file', file);
  if (dest) fd.append('dest', dest);
  if (autoSave) fd.append('autoSave', '1');
  try {
    const r = await fetch('/api/import', { method: 'POST', body: fd });
    return await r.json();
  } catch (e) { return { error: 'Could not upload ' + file.name }; }
}

/** One page of a PDF drawn with pdf.js. `src` is a URL or an ArrayBuffer. Children are laid over the page (use % positions). */
export function PdfPage({ src, page, width, onPages, children, onSize }) {
  const ref = React.useRef(null);
  const [doc, setDoc] = React.useState(null);
  const [err, setErr] = React.useState('');
  const [size, setSize] = React.useState(null);
  React.useEffect(() => {
    let dead = false; setDoc(null); setErr(''); setSize(null);
    if (!src) return undefined;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const d = await pdfjs.getDocument(Object.assign(typeof src === 'string' ? { url: src } : { data: new Uint8Array(src.slice(0)) }, { standardFontDataUrl: '/pdf-fonts/' })).promise;
        if (dead) return;
        setDoc(d); if (onPages) onPages(d.numPages);
      } catch (e) { if (!dead) setErr('This PDF could not be shown.'); }
    })();
    return () => { dead = true; };
  }, [src]);
  React.useEffect(() => {
    if (!doc) return undefined;
    let dead = false, task = null;
    (async () => {
      const p = await doc.getPage(Math.min(Math.max(1, page || 1), doc.numPages));
      const c = ref.current; if (!c || dead) return;
      const base = p.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const k = (width || 600) / base.width;
      const vp = p.getViewport({ scale: k * dpr });
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const w = vp.width / dpr, h = vp.height / dpr;
      c.style.width = w + 'px'; c.style.height = h + 'px';
      setSize({ w, h }); if (onSize) onSize({ w, h });
      task = p.render({ canvasContext: c.getContext('2d'), viewport: vp });
      try { await task.promise; } catch (e) {}
    })();
    return () => { dead = true; try { if (task) task.cancel(); } catch (e) {} };
  }, [doc, page, width]);
  if (err) return React.createElement('div', { style: { padding: 24, fontSize: 14, color: 'var(--muted)' } }, err);
  return React.createElement('div', { className: 'pdfpage', style: { position: 'relative', flex: 'none', lineHeight: 0, background: '#fff', boxShadow: '0 6px 24px rgba(0,0,0,.18)', borderRadius: 4, width: size ? size.w : 120, height: size ? size.h : 160, maxWidth: 'none', maxHeight: 'none' } },
    React.createElement('canvas', { ref, style: { display: 'block', borderRadius: 4 } }),
    size ? (typeof children === 'function' ? children(size) : children) : null);
}
