import { describe, expect, it } from 'vitest';
import { averageOffset, offsetFromStatements } from './offsetest';

const D = (s: string) => new Date(s + 'T00:00:00Z');
const DAY = 86400000;
// what a $100,000 offset saves over a period, with each day's rate
const saved = (start: string, end: string, rateOn: (t: number) => number) => { let b = 0; for (let t = +D(start); t <= +D(end); t += DAY) b += 100000 * rateOn(t) / 100 / 365; return Math.round(b * 100) / 100; };

describe('the offset balance a statement implies', () => {
  it('divides the benefit by the daily rates, following rate changes in the statement', () => {
    const change = +D('2025-04-04');
    const st = { id: 's1', periodStart: D('2025-02-12'), periodEnd: D('2025-08-11'), offsetBenefit: saved('2025-02-12', '2025-08-11', (t) => (t >= change ? 6.1 : 6.35)), rate: 6.35 };
    const lines = [{ statementId: 's1', date: D('2025-02-12'), rate: 6.35 }, { statementId: 's1', date: D('2025-04-04'), rate: 6.1 }];
    expect(averageOffset(st, lines)).toBe(100000);
  });
  it('uses the statement rate when it prints no rate lines, and skips statements with no benefit', () => {
    const st = { id: 's2', periodStart: D('2025-02-12'), periodEnd: D('2025-08-11'), offsetBenefit: saved('2025-02-12', '2025-08-11', () => 5), rate: 5 };
    expect(averageOffset(st, [])).toBe(100000);
    expect(averageOffset({ ...st, offsetBenefit: 0 }, [])).toBeNull();
  });
  it('adds splits ending on the same day together, oldest period first', () => {
    const a = { id: 'a', periodStart: D('2025-08-12'), periodEnd: D('2026-02-11'), offsetBenefit: saved('2025-08-12', '2026-02-11', () => 5), rate: 5 };
    const b = { ...a, id: 'b' };
    const c = { id: 'c', periodStart: D('2025-02-12'), periodEnd: D('2025-08-11'), offsetBenefit: saved('2025-02-12', '2025-08-11', () => 5), rate: 5 };
    expect(offsetFromStatements([a, b, c], [])).toEqual([{ start: '2025-02-12', end: '2025-08-11', amount: 100000 }, { start: '2025-08-12', end: '2026-02-11', amount: 200000 }]);
  });
});
