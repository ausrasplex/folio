// Transaction categories: the built-in list, the household's own categories, and its rules.
// A transaction's category is, in order: the one a person chose for it, the first of the household's rules that
// matches it, or the built-in guess from its description.

export type CategoryKind = 'spend' | 'income' | 'transfer';
export type RuleRow = {
  id: string; category: string; terms: string; match: string; direction: string;
  amountMin: number | null; amountMax: number | null; accountId: string | null; priority: number; enabled: boolean;
};
export type TxnLike = { description: string; debit: number; credit: number; accountId?: string | null; category?: string | null };

/** The built-in categories, with the description words that suggest them (money out). */
const GUESSES: [RegExp, string][] = [
  // first: money moved between accounts (banks label these INTERNET WITHDRAWAL and the like)
  [/transfer|\btfr\b|repaymt|repayment|withdrawal/, 'Transfers'],
  // paying off a credit card from another account (CC AUTO PAYMENT, CREDIT CARD PAYMENT) moves money too
  [/\bcc\b.*payment|credit card|card payment/, 'Transfers'],
  // a credit card's own interest and charges
  [/interest|cash advance/, 'Fees'],
  [/shell|bp|caltex|ampol|7-eleven|fuel|petrol|united petroleum/, 'Fuel'],
  [/woolworths|coles|aldi|iga|grocer|supermarket|harris farm/, 'Groceries'],
  [/cafe|coffee|restaurant|uber eats|menulog|doordash|mcdonald|kfc|pizza|bar |pub /, 'Food and dining'],
  [/bunnings|ikea|kmart|target|big w|officeworks|hardware/, 'Household'],
  [/myki|opal|uber|didi|taxi|parking|toll|linkt|transport/, 'Transport'],
  [/energy|electric|gas|water|agl|origin|red energy|alinta/, 'Utilities'],
  [/insurance|nrma|racv|budget direct|allianz|aami/, 'Insurance'],
  [/council|rates/, 'Rates'],
  [/telstra|optus|vodafone|internet|nbn|aussie broadband/, 'Phone and internet'],
  [/fee|charge/, 'Fees']
];

export const BUILT_IN: { name: string; kind: CategoryKind }[] = [
  ...['Groceries', 'Food and dining', 'Fuel', 'Household', 'Transport', 'Utilities', 'Insurance', 'Rates', 'Phone and internet', 'Fees', 'Other'].map((name) => ({ name, kind: 'spend' as const })),
  { name: 'Income', kind: 'income' }, { name: 'Interest', kind: 'income' }, { name: 'Transfers', kind: 'transfer' }
];

/** The built-in guess from a description alone. */
export function categorize(desc: string, credit: number) {
  const d = desc.toLowerCase();
  if (credit > 0) {
    if (/interest/.test(d)) return 'Interest';
    // a payment into a credit card (PAYMENT RECEIVED - THANK YOU) is money moved from another account
    if (/transfer|tfr|deposit|payment|thank you/.test(d)) return 'Transfers';
    // a refund gives money back for spending; it is not income
    if (/refund|reversal|returned/.test(d)) return 'Other';
    return 'Income';
  }
  for (const [re, c] of GUESSES) if (re.test(d)) return c;
  return 'Other';
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
/** The words a rule looks for: one per line (commas also separate them). */
export const ruleTerms = (terms: string) => terms.split(/[\n,]/).map(squash).filter(Boolean);
/** A wildcard term (* any run of characters, ? one character), found anywhere in the description; nothing else is special. */
const wildcard = (term: string) => new RegExp(term.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.'));

/** Whether a rule matches a transaction. Every condition the rule sets must hold. */
export function ruleMatches(r: RuleRow, t: TxnLike) {
  if (!r.enabled) return false;
  if (r.accountId && t.accountId !== r.accountId) return false;
  if (r.direction === 'out' && !(t.debit > 0)) return false;
  if (r.direction === 'in' && !(t.credit > 0)) return false;
  const amount = r.direction === 'in' ? t.credit : r.direction === 'out' ? t.debit : t.debit || t.credit;
  if (r.amountMin != null && amount < r.amountMin - 0.001) return false;
  if (r.amountMax != null && amount > r.amountMax + 0.001) return false;
  const words = ruleTerms(r.terms);
  if (!words.length) return true; // a rule on amount, direction or account alone
  const d = squash(t.description);
  if (r.match === 'starts') return words.some((w) => d.startsWith(w));
  if (r.match === 'equals') return words.some((w) => d === w);
  if (r.match === 'pattern') return words.some((w) => wildcard(w).test(d));
  return words.some((w) => d.includes(w));
}

/** A transaction's category and where it came from: chosen for it, a rule, or the built-in guess. */
export function categoryOf(t: TxnLike, rules: RuleRow[]): { name: string; by: 'you' | 'rule' | 'auto'; ruleId?: string } {
  if (t.category) return { name: t.category, by: 'you' };
  for (const r of rules) if (ruleMatches(r, t)) return { name: r.category, by: 'rule', ruleId: r.id };
  return { name: categorize(t.description, t.credit), by: 'auto' };
}

/** Rules in the order they are tried. */
export const ordered = <R extends { priority: number }>(rules: R[]) => [...rules].sort((a, b) => a.priority - b.priority);

/** Whether a category counts as spending (not income and not a transfer between accounts). */
export function kindOf(name: string, own: { name: string; kind: string }[]): CategoryKind {
  const k = own.find((c) => c.name === name)?.kind || BUILT_IN.find((c) => c.name === name)?.kind || 'spend';
  return k === 'income' || k === 'transfer' ? k : 'spend';
}

/** The colours a category chip can have (names; the screens hold the shades, which read in light and dark themes). */
export const COLORS = ['grey', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal', 'sky', 'blue', 'indigo', 'violet', 'pink', 'rose'] as const;
const DEFAULT_COLOR: Record<string, string> = {
  Groceries: 'green', 'Food and dining': 'orange', Fuel: 'amber', Household: 'teal', Transport: 'sky', Utilities: 'yellow', Insurance: 'indigo',
  Rates: 'violet', 'Phone and internet': 'blue', Fees: 'red', Other: 'grey', Income: 'lime', Interest: 'lime', Transfers: 'pink'
};
/** A category's colour: the one chosen for it, else its built-in default, else one picked from its name. */
export function colorOf(name: string, chosen: Record<string, string | null | undefined>) {
  const c = chosen[name];
  if (c && (COLORS as readonly string[]).includes(c)) return c;
  if (DEFAULT_COLOR[name]) return DEFAULT_COLOR[name];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[1 + (h % (COLORS.length - 1))]; // not grey, which reads as "nothing chosen"
}
