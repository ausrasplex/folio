// Builds everything the signed-in person may see in their current household, in the shapes the screens use.
// Access rule: loans you are a borrower on and accounts you hold. Shared records (lenders, brokers, layouts)
// never reveal anything about loans or accounts you cannot see.
import { db } from './db';
import { dec } from './crypto';
import { currentMembership, type CurrentUser } from './auth';
import { APP_VERSION, backupSettings, dirSize, folderPath, freeSpace } from './backup';
import { securityRows } from './security';
import { startRateOffers } from './rates';
import { chargeDay, type Txn } from './importer';
import { offsetFromStatements, type BenefitStatement } from './offsetest';
import { DAY, FREQ_WORD, num, summarize, today0, yearFrac, type SplitRow } from './loanmath';

const SLOTS = ['a1', 'a2', 'a3'];
export const initials = (name: string) => { const w = (name || '?').trim().split(/\s+/).filter(Boolean); return ((w.length > 1 ? w[0][0] + w[w.length - 1][0] : (w[0] || '?').slice(0, 2)) || '?').toUpperCase(); };
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-AU');
const monY = (d: Date | null) => (d ? d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const dLong = (d: Date | null) => (d ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const ROLE: Record<string, string> = { OWNER: 'Owner', EDITOR: 'Editor', VIEWER: 'Viewer' };

export const splitInclude = {
  rateChanges: true,
  repaymentChanges: true,
  statements: { where: { deletedAt: null }, select: { id: true, periodStart: true, periodEnd: true, closing: true, opening: true, interest: true, credits: true, rate: true, paymentsInAdvance: true, offsetBenefit: true, deletedAt: true } }
} as const;

export function categorize(desc: string, credit: number) {
  const d = desc.toLowerCase();
  if (credit > 0) return /interest/.test(d) ? 'Interest' : 'Income';
  const rules: [RegExp, string][] = [
    [/shell|bp |caltex|ampol|7-eleven|fuel|petrol|united petroleum/, 'Fuel'],
    [/woolworths|coles|aldi|iga|grocer|supermarket|harris farm/, 'Groceries'],
    [/cafe|coffee|restaurant|uber eats|menulog|doordash|mcdonald|kfc|pizza|bar |pub /, 'Food and dining'],
    [/bunnings|ikea|kmart|target|big w|officeworks|hardware/, 'Household'],
    [/myki|opal|uber|didi|taxi|parking|toll|linkt|transport/, 'Transport'],
    [/energy|electric|gas|water|agl|origin|red energy|alinta/, 'Utilities'],
    [/insurance|nrma|racv|budget direct|allianz|aami/, 'Insurance'],
    [/council|rates/, 'Rates'],
    [/telstra|optus|vodafone|internet|nbn|aussie broadband/, 'Phone and internet'],
    [/fee|charge/, 'Fees'],
    [/transfer|tfr|repaymt|repayment/, 'Transfers']
  ];
  for (const [re, c] of rules) if (re.test(d)) return c;
  return 'Other';
}

export async function buildState(u: CurrentUser) {
  const { m, all } = await currentMembership(u);
  const prefs = (u.prefs || {}) as Record<string, unknown>;
  const sessions = await db.session.findMany({ where: { userId: u.id }, orderBy: { lastSeen: 'desc' } });
  const me = {
    id: u.id, name: u.displayName, email: u.email, pendingEmail: u.pendingEmail, initials: initials(u.displayName), photo: u.photo || '',
    isAdmin: u.isAdmin, theme: u.theme, mode: u.mode, prefs, readAlerts: (prefs.readAlerts as string[]) || [], totpOn: u.totpOn,
    recoveryLeft: Array.isArray(u.recoveryCodes) ? (u.recoveryCodes as unknown[]).length : 0,
    sessions: sessions.map((s) => ({ id: s.id, current: s.id === u.sessionId, agent: s.userAgent || '', ip: s.ip || '', lastSeen: s.lastSeen.toISOString(), created: s.createdAt.toISOString() })),
    role: m ? ROLE[m.role] : '', canManage: !!m && (m.role === 'OWNER' || u.isAdmin), canEdit: !!m && m.role !== 'VIEWER'
  };
  const hhCounts = await db.membership.groupBy({ by: ['householdId', 'role'], where: { householdId: { in: all.map((x) => x.householdId) }, removedAt: null }, _count: true });
  const households = all.map((x) => ({ id: x.householdId, name: x.household.name, role: ROLE[x.role], current: !!m && x.householdId === m.householdId,
    members: hhCounts.filter((c) => c.householdId === x.householdId).reduce((t, c) => t + c._count, 0), owners: hhCounts.filter((c) => c.householdId === x.householdId && c.role === 'OWNER').reduce((t, c) => t + c._count, 0) }));
  if (!m) return { me, households, household: null, noHousehold: true };
  const hid = m.householdId;

  // ----- people
  const mems = await db.membership.findMany({ where: { householdId: hid }, include: { user: true }, orderBy: { joinedAt: 'asc' } });
  const slotOf: Record<string, string> = {};
  mems.forEach((x, i) => { slotOf[x.userId] = SLOTS[i % 3]; });

  // ----- loans and accounts you can see
  const loanRows = await db.loan.findMany({
    where: { householdId: hid, borrowers: { some: { userId: u.id } } },
    include: { lender: true, broker: true, borrowers: { include: { user: true } }, splits: { where: { deletedAt: null }, include: splitInclude, orderBy: { sortOrder: 'asc' } }, events: { where: { deletedAt: null }, orderBy: { date: 'asc' } } },
    orderBy: { createdAt: 'asc' }
  });
  const deletedSplits = await db.loanSplit.findMany({ where: { loan: { householdId: hid, borrowers: { some: { userId: u.id } } }, deletedAt: { not: null } } });
  const acctRows = await db.account.findMany({
    where: { householdId: hid, deletedAt: null, holders: { some: { userId: u.id } } },
    include: { lender: true, holders: { include: { user: true } }, statements: { where: { deletedAt: null }, orderBy: { periodEnd: 'asc' }, include: { txns: { orderBy: [{ date: 'asc' }, { row: 'asc' }] } } } },
    orderBy: { createdAt: 'asc' }
  });
  const hiddenLoans = await db.loan.findMany({ where: { householdId: hid, NOT: { borrowers: { some: { userId: u.id } } } }, select: { lenderId: true, brokerId: true, status: true } });
  const hiddenAccts = await db.account.findMany({ where: { householdId: hid, deletedAt: null, NOT: { holders: { some: { userId: u.id } } } }, select: { lenderId: true, closedAt: true } });

  const acctBalance = (a: (typeof acctRows)[number]) => {
    const st = a.statements[a.statements.length - 1];
    return st ? num(st.closing) : num(a.openingBalance);
  };

  // ----- accounts
  const now = today0();
  const accounts = acctRows.map((a, i) => {
    const txns = a.statements.flatMap((s) => s.txns.map((t) => ({ ...t, stId: s.id })));
    const bal = acctBalance(a);
    const monthEnds: Date[] = []; for (let k = 11; k >= 0; k--) monthEnds.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 0)));
    const balAt = (d: Date) => {
      let b: number | null = null;
      for (const s of a.statements) { if (s.periodEnd <= d) b = num(s.closing); for (const t of s.txns) if (t.date <= d && t.balance != null) b = num(t.balance); }
      return b == null ? (a.openingDate && a.openingDate <= d ? num(a.openingBalance) : 0) : b;
    };
    const hist = monthEnds.map((d, k) => (k === 11 ? bal : balAt(d)));
    const inMonth = (d: Date, k: number) => { const e = monthEnds[k]; return d.getUTCFullYear() === e.getUTCFullYear() && d.getUTCMonth() === e.getUTCMonth(); };
    const inc = monthEnds.map((_, k) => Math.round(txns.filter((t) => inMonth(t.date, k)).reduce((s, t) => s + num(t.credit), 0)));
    const exp = monthEnds.map((_, k) => Math.round(txns.filter((t) => inMonth(t.date, k)).reduce((s, t) => s + num(t.debit), 0)));
    const lastEnd = a.statements.length ? a.statements[a.statements.length - 1].periodEnd : now;
    const since = new Date(+lastEnd - 30 * DAY);
    const cat: Record<string, number> = {};
    txns.filter((t) => t.date >= since && num(t.debit) > 0).forEach((t) => { const c = t.category || categorize(t.description, 0); if (c === 'Transfers') return; cat[c] = (cat[c] || 0) + num(t.debit); });
    const cats = Object.entries(cat).sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, Math.round(v)]);
    const recent = txns.slice(-6).reverse().map((t) => [Math.max(0, Math.round((+now - +t.date) / DAY)), t.description, num(t.credit) - num(t.debit), t.category || categorize(t.description, num(t.credit))]);
    const holderNames = a.holders.map((h) => h.user.displayName);
    return {
      id: a.id, name: a.name, lenderId: a.lenderId, lender: a.lender.name, purpose: a.type, type: a.type,
      holders: a.holders.map((h) => h.userId), holderPeople: a.holders.map((h) => ({ id: h.userId, name: h.user.displayName, ini: initials(h.user.displayName), slot: slotOf[h.userId] || 'a1' })),
      slot: SLOTS[i % 3], initial: (a.name || '?').charAt(0).toUpperCase(), link: a.offsetLoanId,
      bsb: dec(a.bsb), num: dec(a.number), holder: a.nameOnAccount || holderNames.join(' and '),
      balance: bal, hist, inc, exp, cats, tx: recent, statementCount: a.statements.length,
      lastStatement: a.statements.length ? iso(a.statements[a.statements.length - 1].periodEnd) : '',
      openedAt: a.openedAt ? monY(a.openedAt) : '', openedIso: iso(a.openedAt), closedAt: a.closedAt ? monY(a.closedAt) : '', closedIso: iso(a.closedAt),
      monthsFrom: monthEnds.map((d) => d.toLocaleDateString('en-AU', { month: 'short', timeZone: 'UTC' }))
    };
  });

  // ----- loans
  const linkedOffset = (loanId: string) => accounts.filter((a) => a.link === loanId && !a.closedIso);
  // a loan with no linked offset account: the offset balance its statements' offset benefit implies, period by period
  const benefitRows: (BenefitStatement & { loanId: string })[] = loanRows.flatMap((l) => (linkedOffset(l.id).length ? [] : l.splits.flatMap((s) => s.statements
    .filter((st) => !st.deletedAt && st.offsetBenefit != null && num(st.offsetBenefit) > 0)
    .map((st) => ({ loanId: l.id, id: st.id, periodStart: st.periodStart, periodEnd: st.periodEnd, offsetBenefit: num(st.offsetBenefit), rate: st.rate == null ? null : num(st.rate) })))));
  const rateLines = benefitRows.length ? (await db.txn.findMany({ where: { statementId: { in: benefitRows.map((b) => b.id) }, rate: { not: null } }, select: { statementId: true, date: true, rate: true } })).map((r) => ({ statementId: r.statementId, date: r.date, rate: num(r.rate) })) : [];
  const offsetEst = new Map(loanRows.map((l) => [l.id, offsetFromStatements(benefitRows.filter((b) => b.loanId === l.id), rateLines, l.lender.dayCount)]));
  const offsetFor = (loanId: string) => { const linked = linkedOffset(loanId); if (linked.length) return linked.reduce((t, a) => t + a.balance, 0); const est = offsetEst.get(loanId) || []; return est.length ? est[est.length - 1].amount : 0; };
  // splits whose starting rate is still the one typed in, where the first statement shows a different one
  const startOffers = await startRateOffers(loanRows.flatMap((l) => l.splits.map((s) => s.id)));
  // the day each loan's interest is charged, from its statements' interest lines (for loans with no posting day set)
  const chargeLines = await db.txn.findMany({ where: { debit: { gt: 0 }, description: { contains: 'interest', mode: 'insensitive' }, statement: { deletedAt: null, split: { loanId: { in: loanRows.filter((l) => !l.postingDay).map((l) => l.id) } } } }, select: { date: true, description: true, debit: true, statement: { select: { split: { select: { loanId: true } } } } } });
  const chargeDayOf = (loanId: string) => chargeDay({ txns: chargeLines.filter((t) => t.statement.split?.loanId === loanId).map((t) => ({ date: t.date.toISOString().slice(0, 10), description: t.description, debit: num(t.debit) })) as unknown as Txn[] });
  const loans = loanRows.map((l, i) => {
    const splits = l.splits as unknown as SplitRow[];
    const sm = summarize({ startDate: l.startDate, termYears: l.termYears, postingDay: l.postingDay, chargeDay: l.postingDay ? null : chargeDayOf(l.id), offsetOrder: l.offsetOrder, dayCount: l.lender.dayCount, splits, offsetBalance: Math.round(offsetFor(l.id)) }); // whole dollars, as the loan page projects it
    const people = l.borrowers.map((b) => ({ id: b.userId, i: initials(b.user.displayName), name: b.user.displayName, slot: slotOf[b.userId] || 'a1' }));
    const fixed = sm.splits.filter((x) => x.s.kind === 'FIXED' && x.s.fixedUntil && x.s.fixedUntil > now).sort((a, b) => +a.s.fixedUntil! - +b.s.fixedUntil!)[0];
    const fx = fixed ? fixed.s.fixedUntil : null;
    let status = 'On schedule', tone = 'good';
    if (fx && (+fx - +now) / DAY < 365) { status = 'Fixed term ends ' + dLong(fx); tone = 'warn'; }
    else if (sm.ahead > 500) status = money(sm.ahead) + ' ahead of schedule';
    else if (sm.ahead < -500) { status = money(-sm.ahead) + ' behind schedule'; tone = 'warn'; }
    const sp0 = sm.splits[0];
    const rateText = sm.splits.length > 1 ? sm.splits.length + ' splits' : sp0 ? sp0.rate.toFixed(2) + '% ' + (sp0.s.kind === 'FIXED' ? 'fixed' : 'variable') : '';
    const repayText = sm.splits.length === 1 && sp0 ? money(sp0.repay) + ' ' + FREQ_WORD[sp0.freq] : sm.splits.length > 1 && sm.splits.every((x) => x.freq === sm.splits[0].freq) ? money(sm.splits.reduce((t, x) => t + x.repay, 0)) + ' ' + FREQ_WORD[sm.splits[0].freq] : money(sm.perMonth) + ' monthly';
    const archived = l.status === 'archived';
    const lenderView = archived && l.lenderSnapshot ? (l.lenderSnapshot as Record<string, unknown>) : null;
    return {
      id: l.id, name: l.name, purpose: l.purpose, lenderId: l.lenderId, lender: (lenderView?.name as string) || l.lender.name, brokerId: l.brokerId,
      kind: l.purpose + (sm.splits.length > 1 ? ', ' + sm.splits.length + ' splits' : ''), slot: SLOTS[i % 3], initial: (l.name || '?').charAt(0).toUpperCase(),
      people, who: people.length > 1 ? 'Joint' : people.length === 1 && people[0].id === u.id ? 'Just you' : people.map((p) => p.name).join(', '), joint: people.length > 1,
      bal: Math.round(sm.bal), balExact: sm.bal, orig: Math.round(sm.orig), rNum: Math.round(sm.rate * 100) / 100, rate: rateText, repay: repayText, perMonth: sm.perMonth,
      next: sm.next ? sm.next.toISOString() : '', payoff: monY(sm.payoff), payoffIso: iso(sm.payoff), pEnd: sm.payoff ? yearFrac(sm.payoff) : yearFrac(now) + 40,
      start: yearFrac(l.startDate), startIso: iso(l.startDate), term: l.termYears, ahead: Math.round(sm.ahead), status, tone, series: sm.series, asAt: iso(sm.asAt),
      offset: offsetFor(l.id), offsetEst: !linkedOffset(l.id).length && (offsetEst.get(l.id) || []).length > 0, offsetHist: linkedOffset(l.id).length ? [] : offsetEst.get(l.id) || [], offsetAccounts: accounts.filter((a) => a.link === l.id).map((a) => a.id), totalInterest: Math.round(sm.totalInterest),
      postingDay: sm.postingDay, postingDaySet: l.postingDay != null, offsetOrder: l.offsetOrder, redraw: l.redraw, accountNumber: dec(l.accountNumber), customerId: dec(l.customerId),
      archived, closedReason: l.closedReason || '', closedAt: iso(l.closedAt), dates: monY(l.startDate) + ' – ' + (l.closedAt ? monY(l.closedAt) : ''),
      lenderSnapshot: l.lenderSnapshot, brokerSnapshot: l.brokerSnapshot,
      splits: sm.splits.map((x, k) => ({
        id: x.s.id, name: x.s.name, startOffer: startOffers.get(x.s.id) || null, suffix: x.s.accountSuffix || String(k + 1).padStart(2, '0'), kind: x.s.kind === 'FIXED' ? 'fixed' : 'variable', fixedUntil: iso(x.s.fixedUntil),
        bal: x.bal, balDate: iso(x.balDate), balFrom: x.balFrom, orig: num(x.s.openingBalance), rate: x.rate, rateSince: iso(x.rateSince), startRate: num(x.s.startRate),
        series: x.series, payoff: monY(x.payoff), payoffIso: iso(x.payoff),
        repay: x.repay, freq: FREQ_WORD[x.freq], repayDay: x.s.repayDay, anchor: iso(x.s.anchorDate), io: x.s.interestOnly,
        rates: [{ date: iso(l.startDate), rate: num(x.s.startRate), confirmed: true }].concat(x.s.rateChanges.filter((c) => !c.deletedAt).sort((a, b) => +a.effectiveDate - +b.effectiveDate).map((c) => ({ date: iso(c.effectiveDate), rate: num(c.rate), confirmed: c.confirmed, id: (c as unknown as { id: string }).id }))),
        repayments: x.s.repaymentChanges.filter((c) => !c.deletedAt).map((c) => ({ date: iso(c.effectiveDate), amount: num(c.amount), freq: FREQ_WORD[c.frequency] })),
        statements: x.s.statements.filter((s) => !s.deletedAt).sort((a, b) => +a.periodEnd - +b.periodEnd).map((s) => ({ id: (s as unknown as { id: string }).id, start: iso(s.periodStart), end: iso(s.periodEnd), opening: num(s.opening), closing: num(s.closing), interest: num(s.interest), credits: num(s.credits), rate: s.rate == null ? null : num(s.rate), advance: s.paymentsInAdvance == null ? null : num(s.paymentsInAdvance) }))
      })),
      deletedSplits: deletedSplits.filter((s) => s.loanId === l.id).map((s) => ({ id: s.id, name: s.name, reason: s.deleteReason || '', at: iso(s.deletedAt) })),
      events: l.events.map((e) => ({ id: e.id, kind: e.kind, date: iso(e.date), amount: e.amount == null ? null : num(e.amount), note: e.note || '', splitId: e.splitId }))
    };
  });

  // ----- lenders and brokers (shared in the household)
  const lenderRows = await db.lender.findMany({ where: { householdId: hid }, orderBy: { createdAt: 'asc' } });
  const brokerRows = await db.broker.findMany({ where: { householdId: hid }, orderBy: { createdAt: 'asc' } });
  const lenderOut = (l: (typeof lenderRows)[number]) => ({
    id: l.id, name: l.name, currency: l.currency, basis: l.dayCount + '-day year', dayCount: l.dayCount, website: l.website || '', phone: l.phone || '', email: l.email || '', note: l.note || '', icon: l.icon || '', logo: l.logo || '',
    hiddenUse: hiddenLoans.some((x) => x.lenderId === l.id && x.status === 'active') || hiddenAccts.some((x) => x.lenderId === l.id && !x.closedAt),
    deletedAt: iso(l.deletedAt)
  });
  const brokerOut = (b: (typeof brokerRows)[number]) => ({
    id: b.id, name: b.name, company: b.company || '', licence: b.licence || '', address: b.address || '', phone: b.phone || '', email: b.email || '', website: b.website || '', note: b.note || '', photo: b.photo || '',
    loans: loans.filter((l) => l.brokerId === b.id && !l.archived).map((l) => l.id), reviewOn: b.reviewOn, lastReview: iso(b.lastReview), every: b.reviewEvery,
    hiddenUse: hiddenLoans.some((x) => x.brokerId === b.id && x.status === 'active'), deletedAt: iso(b.deletedAt)
  });
  const lenders = lenderRows.filter((l) => !l.deletedAt).map(lenderOut);
  const brokers = brokerRows.filter((b) => !b.deletedAt).map(brokerOut);
  const deletedLenders = lenderRows.filter((l) => l.deletedAt).map(lenderOut);
  const deletedBrokers = brokerRows.filter((b) => b.deletedAt).map(brokerOut);

  // ----- statements (only for what you can see)
  const splitIds = loans.flatMap((l) => l.splits.map((s) => s.id));
  const acctIds = accounts.map((a) => a.id);
  const stRows = await db.statement.findMany({
    where: { householdId: hid, OR: [{ splitId: { in: splitIds } }, { accountId: { in: acctIds } }] },
    include: { layoutVersion: { include: { layout: true } }, file: { select: { id: true, name: true, mime: true, size: true } } },
    orderBy: { periodEnd: 'desc' }
  });
  const statements = stRows.map((s) => ({
    id: s.id, splitId: s.splitId, accountId: s.accountId, start: iso(s.periodStart), end: iso(s.periodEnd),
    opening: num(s.opening), closing: num(s.closing), interest: num(s.interest), credits: num(s.credits), debits: num(s.debits),
    advance: s.paymentsInAdvance == null ? null : num(s.paymentsInAdvance), rate: s.rate == null ? null : num(s.rate),
    status: s.status, note: s.statusNote || '', reviewedAt: iso(s.reviewedAt), reviewNote: s.reviewNote || '',
    layout: s.layoutVersion ? { id: s.layoutVersion.layoutId, name: s.layoutVersion.layout.name, version: s.layoutVersion.version } : null,
    file: s.file ? { id: s.file.id, name: s.file.name, mime: s.file.mime, size: s.file.size } : null, pages: s.pages,
    importedAt: s.importedAt.toISOString(), importedBy: (mems.find((x) => x.userId === s.importedById)?.user.displayName) || '',
    deletedAt: iso(s.deletedAt), deleteReason: s.deleteReason || ''
  }));

  // ----- layouts (server-wide; usage counts only from statements you can see)
  const layoutRows = await db.layout.findMany({ include: { versions: { orderBy: { version: 'asc' } } }, orderBy: { createdAt: 'asc' } });
  const usage: Record<string, Record<string, number>> = {};
  for (const s of stRows) {
    if (!s.layoutVersion || s.deletedAt) continue;
    const src = s.splitId ? loans.find((l) => l.splits.some((x) => x.id === s.splitId)) : null;
    const sp = src ? src.splits.find((x) => x.id === s.splitId) : null;
    const name = src ? src.name + (src.splits.length > 1 && sp ? ' · ' + sp.name : '') : accounts.find((a) => a.id === s.accountId)?.name || '';
    const k = s.layoutVersion.layoutId;
    usage[k] = usage[k] || {};
    usage[k][name] = (usage[k][name] || 0) + 1;
  }
  const allUse = await db.statement.groupBy({ by: ['layoutVersionId'], where: { deletedAt: null, layoutVersionId: { not: null } }, _count: true, _max: { importedAt: true } });
  const layouts = layoutRows.map((l) => {
    const vIds = l.versions.map((v) => v.id);
    const total = allUse.filter((x) => x.layoutVersionId && vIds.includes(x.layoutVersionId)).reduce((t, x) => t + x._count, 0);
    const lastMatch = allUse.filter((x) => x.layoutVersionId && vIds.includes(x.layoutVersionId)).map((x) => x._max.importedAt).filter(Boolean).sort((a, b) => +b! - +a!)[0] || null;
    return {
      id: l.id, name: l.name, lenderName: l.lenderName, lender: lenders.find((x) => x.name.toLowerCase() === l.lenderName.toLowerCase())?.id || '', kind: l.kind, fmt: l.format,
      status: l.status === 'remap' ? 'remap' : total ? 'ok' : 'new', failed: l.failedNote || '', usedHidden: total > Object.values(usage[l.id] || {}).reduce((t, n) => t + n, 0), lastMatch: iso(lastMatch),
      used: Object.entries(usage[l.id] || {}), deletedAt: iso(l.deletedAt),
      versions: l.versions.map((v) => ({ id: v.id, n: v.version, date: dLong(v.createdAt), by: v.createdBy, map: v.map })),
      phrases: ((l.versions[l.versions.length - 1]?.fingerprint as { phrases?: string[] } | null)?.phrases) || [],
      map: (l.versions[l.versions.length - 1]?.map as Record<string, unknown>) || {}
    };
  });

  // ----- members, invites, removed members
  const members = mems.filter((x) => !x.removedAt).map((x) => {
    const shared = loans.filter((l) => !l.archived && l.people.some((p) => p.id === x.userId)).map((l) => l.name).concat(accounts.filter((a) => a.holders.includes(x.userId)).map((a) => a.name));
    return { id: x.userId, name: x.user.displayName, you: x.userId === u.id, ini: initials(x.user.displayName), slot: slotOf[x.userId], photo: x.user.photo || '', role: x.user.isAdmin && x.userId === u.id ? 'Admin' : ROLE[x.role], baseRole: ROLE[x.role], isAdmin: x.user.isAdmin, joined: monY(x.joinedAt), shares: x.userId === u.id ? '' : shared.length ? 'Shares ' + shared.slice(0, 2).join(' and ') + (shared.length > 2 ? ' and ' + (shared.length - 2) + ' more' : '') + ' with you' : 'Nothing shared with you' };
  });
  const removedMembers = mems.filter((x) => x.removedAt).map((x) => ({ id: x.userId, name: x.user.displayName, ini: initials(x.user.displayName), slot: slotOf[x.userId], role: ROLE[x.role], removed: dLong(x.removedAt) }));
  const invites = me.canManage ? (await db.invite.findMany({ where: { householdId: hid, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } })).map((i) => ({ id: i.id, role: ROLE[i.role], made: i.createdAt.toISOString(), expires: i.expiresAt.toISOString(), token: i.token })) : [];

  // ----- notifications
  const notifications = buildAlerts({ loans, accounts, brokers, layouts, statements, me, prefs });

  // ----- server (admin)
  const settings = Object.fromEntries((await db.serverSetting.findMany()).map((s) => [s.key, s.value]));
  const channels = (await db.channel.findMany({ where: { userId: u.id } })).map((c) => ({ service: c.service, amounts: c.amounts, config: Object.fromEntries(Object.entries((c.config as Record<string, string>) || {}).map(([k, v]) => [k, /token|secret/i.test(k) ? (v ? '••••••' : '') : v])) }));
  const server = u.isAdmin ? await serverInfo() : null;

  return {
    // your own newest 50 security events (sign-ins, password and two-step changes...)
    me: { ...me, securityLog: await securityRows({ userId: u.id }, 50) }, households, household: { id: hid, name: m.household.name }, members, removedMembers, invites,
    lenders, brokers, deletedLenders, deletedBrokers, loans: loans.filter((l) => !l.archived), archivedLoans: loans.filter((l) => l.archived),
    accounts: accounts.filter((a) => !a.closedIso), closedAccounts: accounts.filter((a) => !!a.closedIso), statements, layouts, notifications,
    settings, channels, server, origin: process.env.FOLIO_URL || ''
  };
}

async function serverInfo() {
  const backups = await db.backup.findMany({ orderBy: { createdAt: 'desc' }, take: 30 });
  const files = await db.storedFile.aggregate({ _sum: { size: true }, _count: true });
  const hh = await db.household.count({ where: { deletedAt: null } });
  const people = await db.user.count();
  const loansAccts = (await db.loan.count()) + (await db.account.count({ where: { deletedAt: null } }));
  const statementsN = await db.statement.count({ where: { deletedAt: null } });
  const dbSize = Number(((await db.$queryRawUnsafe('select pg_database_size(current_database()) as s')) as { s: bigint }[])[0]?.s || 0);
  const bs = await backupSettings();
  const dir = folderPath(bs.folder);
  const disk = await freeSpace(dir);
  const first = await db.user.findFirst({ orderBy: { createdAt: 'asc' } });
  return {
    backups: backups.map((b) => ({ id: b.id, name: b.fileName, size: b.size, auto: b.auto, at: b.createdAt.toISOString() })),
    // the whole server's newest security events, with each person named
    securityLog: await securityRows({}, 50, new Map((await db.user.findMany({ select: { id: true, displayName: true } })).map((x) => [x.id, x.displayName]))),
    fileBytes: files._sum.size || 0, fileCount: files._count, households: hh, people, loansAccts, statements: statementsN, dbBytes: dbSize,
    backupBytes: await dirSize(dir), diskFree: disk.free, diskTotal: disk.total, backupSettings: bs, backupDir: dir, version: APP_VERSION, since: first ? first.createdAt.toISOString() : ''
  };
}

type Built = { loans: { id: string; name: string; splits: { id: string; name: string; startOffer?: { rate: number; from: string; current: number } | null; rates: { date: string; rate: number; confirmed: boolean }[] }[]; archived: boolean }[]; accounts: { id: string; name: string }[]; brokers: { id: string; name: string; reviewOn: boolean; lastReview: string; every: number; loans: string[] }[]; layouts: { id: string; name: string; lenderName: string; status: string; failed: string }[]; statements: { splitId: string | null; accountId: string | null; end: string; start: string; status: string; deletedAt: string }[]; me: { isAdmin: boolean }; prefs: Record<string, unknown> };

/** Alerts: worked out from the data each time (rate reviews, missing statements, rate changes, re-mapping). */
function buildAlerts(b: Built) {
  const now = today0();
  const out: { id: string; title: string; tag: string; tagStyle: string; text: string; when: string; href: string; fo?: Record<string, string>; at: string }[] = [];
  const warn = 'background:var(--dangerSoft);color:var(--danger)', info = 'background:var(--surface2);color:var(--ink)';
  const choice = ((b.prefs.alerts || {}) as Record<string, boolean>);
  const on = (k: string) => choice[k] !== false;
  const missDays = Number(b.prefs.missDays || 7);
  const lead = String(b.prefs.revLead || 'week');
  const leadDays = lead === 'day' ? 0 : lead === 'fort' ? 14 : 7;
  if (on('review')) for (const br of b.brokers) {
    if (!br.reviewOn || !br.lastReview || !br.loans.length) continue;
    const next = new Date(br.lastReview + 'T00:00:00Z'); next.setUTCMonth(next.getUTCMonth() + (br.every || 6));
    const days = Math.round((+next - +now) / DAY);
    if (days <= leadDays) out.push({ id: 'review-' + br.id + '-' + iso(next), title: 'Rate review due', tag: days < 0 ? 'Overdue' : 'Due', tagStyle: days < 0 ? warn : info, text: br.name + ' was last asked on ' + dLong(new Date(br.lastReview + 'T00:00:00Z')) + '. Ask for a better rate.', when: days < 0 ? 'Overdue by ' + -days + (days === -1 ? ' day' : ' days') : days === 0 ? 'Today' : 'In ' + days + ' days', href: '/settings', fo: { kind: 'broker', id: br.id }, at: iso(next) });
  }
  const sources: { key: string; name: string; isSplit: boolean; id: string }[] = [];
  b.loans.filter((l) => !l.archived).forEach((l) => l.splits.forEach((s) => sources.push({ key: 's' + s.id, name: l.name + (l.splits.length > 1 ? ' · ' + s.name : ''), isSplit: true, id: s.id })));
  b.accounts.forEach((a) => sources.push({ key: 'a' + a.id, name: a.name, isSplit: false, id: a.id }));
  if (on('missing')) for (const src of sources) {
    const sts = b.statements.filter((s) => !s.deletedAt && (src.isSplit ? s.splitId === src.id : s.accountId === src.id)).sort((x, y) => (x.end < y.end ? 1 : -1));
    if (!sts.length) continue;
    const last = new Date(sts[0].end + 'T00:00:00Z');
    const months = sts[1] ? Math.max(1, Math.round((+last - +new Date(sts[1].end + 'T00:00:00Z')) / DAY / 30.4)) : Math.max(1, Math.round((+last - +new Date(sts[0].start + 'T00:00:00Z')) / DAY / 30.4));
    const due = new Date(last); due.setUTCMonth(due.getUTCMonth() + months);
    const late = Math.round((+now - +due) / DAY);
    if (late > missDays) out.push({ id: 'missing-' + src.key + '-' + iso(due), title: 'Statement not imported', tag: 'Action', tagStyle: warn, text: 'The statement for ' + src.name + ' ending about ' + dLong(due) + ' has not been imported yet.', when: late + ' days late', href: '/statements', at: iso(due) });
  }
  if (on('rate')) for (const l of b.loans) for (const s of l.splits) for (const r of s.rates) if (!r.confirmed) out.push({ id: 'rate-' + s.id + '-' + r.date, title: 'Rate change to confirm', tag: 'Review', tagStyle: info, text: 'A statement for ' + l.name + ' shows ' + r.rate.toFixed(2) + '% from ' + dLong(new Date(r.date + 'T00:00:00Z')) + '. Confirm it so forecasts stay accurate.', when: dLong(new Date(r.date + 'T00:00:00Z')), href: '/loan?id=' + l.id + '#details', at: r.date });
  // a starting rate that is still the one typed in when the loan was added, where the first statement shows another
  if (on('rate')) for (const l of b.loans) if (!l.archived) for (const s of l.splits) if (s.startOffer) {
    const o = s.startOffer;
    out.push({ id: 'start-' + s.id + '-' + o.rate, title: 'Starting rate to check', tag: 'Review', tagStyle: info, text: 'The first statement for ' + l.name + (l.splits.length > 1 ? ' · ' + s.name : '') + ' shows ' + o.rate.toFixed(2) + '% from ' + dLong(new Date(o.from + 'T00:00:00Z')) + ', but Folio starts it at ' + o.current.toFixed(2) + '%, the rate when the loan was added.', when: '', href: '/loan?id=' + l.id + '#history', at: '' });
  }
  if (on('remap')) for (const ly of b.layouts) if (ly.status === 'remap') out.push({ id: 'remap-' + ly.id + '-' + (ly.failed || ''), title: 'Layout needs re-mapping', tag: 'Review', tagStyle: info, text: 'The ' + ly.name + ' layout from ' + ly.lenderName + ' no longer matches ' + (ly.failed || 'a new statement') + '.', when: '', href: '/settings', fo: { kind: 'layout', id: ly.id }, at: '' });
  return out.sort((x, y) => (x.at < y.at ? 1 : -1));
}
