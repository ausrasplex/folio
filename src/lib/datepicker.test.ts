import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DatePop, datePicker } from './dc';

// a stand-in screen: holds state.dp like a real one
function screen() {
  const s = { state: {} as Record<string, unknown>, saved: '' as string, setState(u: Record<string, unknown>) { s.state = { ...s.state, ...u }; } };
  return s;
}
const pick = (s: ReturnType<typeof screen>) => datePicker(s, 'start', s.saved || '2026-10-15', (v: string) => { s.saved = v; });
const html = (dp: unknown) => renderToStaticMarkup(React.createElement(DatePop, { dp, label: 'Choose a date' }));

describe('date picker', () => {
  it('opens on the days of the chosen month, with month and year choosers', () => {
    const s = screen();
    pick(s).toggle();
    const dp = pick(s);
    expect(dp.isDays).toBe(true);
    expect(dp.monthName).toBe('October');
    expect(dp.year).toBe('2026');
    const out = html(dp);
    expect(out).toContain('Choose the month, now October');
    expect(out).toContain('Choose the year, now 2026');
    expect(out).toContain('class="dpday"');
  });
  it('choosing a month keeps the year and goes back to the days', () => {
    const s = screen();
    pick(s).toggle();
    pick(s).showMonths();
    const dp = pick(s);
    expect(dp.isMonths).toBe(true);
    expect(html(dp)).toContain('aria-label="March 2026"');
    dp.next(); // arrows step a year in the month view
    expect(pick(s).year).toBe('2027');
    pick(s).months[2].pick();
    const back = pick(s);
    expect(back.isDays).toBe(true);
    expect([back.monthName, back.year]).toEqual(['March', '2027']);
  });
  it('lists every year from 60 back to 40 ahead in one scrolling list, and keeps the month', () => {
    const s = screen();
    pick(s).toggle();
    pick(s).showYears();
    let dp = pick(s);
    const y = new Date().getFullYear();
    expect(dp.isYears).toBe(true);
    expect(dp.years[0].t).toBe(String(y - 60));
    expect(dp.years[dp.years.length - 1].t).toBe(String(y + 40));
    expect(dp.years).toHaveLength(101);
    expect(html(dp)).toContain('class="dpyears"');
    dp.years.find((x) => x.t === String(y - 55))!.pick();
    dp = pick(s);
    expect([dp.isDays, dp.monthName, dp.year]).toEqual([true, 'October', String(y - 55)]);
  });
  it('stretches the year list to include a date chosen further back', () => {
    const s = screen();
    s.saved = '1950-03-01';
    pick(s).toggle();
    pick(s).showYears();
    expect(pick(s).years[0].t).toBe('1950');
  });
  it('marks the current year and still saves the day you pick', () => {
    const s = screen();
    pick(s).toggle();
    pick(s).showYears();
    const thisYear = String(new Date().getFullYear());
    const cur = pick(s).years.find((y) => y.t === thisYear);
    if (cur && !cur.sel) expect(cur.st).toContain('box-shadow');
    pick(s).showYears(); // tapping the year again goes back to the days
    const day = pick(s).cells.find((c) => c.aria.startsWith('Friday 23 October 2026'))!;
    day.pick();
    expect(s.saved).toBe('2026-10-23');
    expect(s.state.dp).toBeNull();
  });
  it('shows nothing while closed', () => {
    expect(html(pick(screen()))).toBe('');
  });
});
