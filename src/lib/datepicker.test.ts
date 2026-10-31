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
  it('choosing a year keeps the month, and the arrows page twelve years', () => {
    const s = screen();
    pick(s).toggle();
    pick(s).showYears();
    let dp = pick(s);
    expect(dp.isYears).toBe(true);
    expect(dp.years.map((y) => y.t)).toEqual(['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026', '2027']);
    expect(html(dp)).toContain('2016 to 2027');
    dp.prev();
    dp = pick(s);
    expect(dp.years[0].t).toBe('2004');
    dp.years.find((y) => y.t === '2009')!.pick();
    dp = pick(s);
    expect([dp.isDays, dp.monthName, dp.year]).toEqual([true, 'October', '2009']);
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
