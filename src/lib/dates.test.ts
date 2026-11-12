import { describe, expect, it } from 'vitest';
import { addDays, dayLabel, diffDays, formatHM, mondayIndex, monthCells, rangeText, todayISO, toISO, weekDates, weekStart } from './dates';

describe('dates', () => {
  it('todayISO 與 toISO 用本地日期', () => {
    expect(todayISO(new Date(2026, 10, 10, 23, 59))).toBe('2026-11-10');
    expect(toISO(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('addDays 可跨月、跨年、閏年', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-11-10', 0)).toBe('2026-11-10');
  });

  it('diffDays 是 b - a，過去為負', () => {
    expect(diffDays('2026-11-08', '2026-11-10')).toBe(2);
    expect(diffDays('2026-11-10', '2026-11-10')).toBe(0);
    expect(diffDays('2026-11-12', '2026-11-10')).toBe(-2);
    expect(diffDays('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('週從星期一開始', () => {
    expect(weekStart('2026-11-10')).toBe('2026-11-09'); // 週二
    expect(weekStart('2026-11-09')).toBe('2026-11-09'); // 週一
    expect(weekStart('2026-11-15')).toBe('2026-11-09'); // 週日
    expect(weekStart('2026-11-16')).toBe('2026-11-16'); // 下週一
    expect(mondayIndex('2026-11-15')).toBe(6);
    expect(weekDates('2026-11-12')).toEqual([
      '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15',
    ]);
  });

  it('日期區間文字', () => {
    expect(rangeText('2026-11-10')).toBe('2026.11.09 – 2026.11.15');
    expect(rangeText('2026-12-31')).toBe('2026.12.28 – 2027.01.03');
  });

  it('日期標籤', () => {
    expect(dayLabel('2026-11-12')).toBe('11/12（四）');
    expect(dayLabel('2026-11-15')).toBe('11/15（日）');
    expect(dayLabel('2026-11-09')).toBe('11/9（一）');
  });

  it('月曆格以星期一開頭補空格', () => {
    // 2026-11-01 是星期日 → 前面 6 格空
    const nov = monthCells(2026, 10);
    expect(nov.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(nov[6]).toBe('2026-11-01');
    expect(nov.length).toBe(6 + 30);
    // 2026-06-01 是星期一 → 不補空
    const jun = monthCells(2026, 5);
    expect(jun[0]).toBe('2026-06-01');
    expect(jun.length).toBe(30);
  });

  it('formatHM 補零', () => {
    expect(formatHM(new Date(2026, 10, 10, 8, 5).getTime())).toBe('08:05');
    expect(formatHM(new Date(2026, 10, 10, 18, 30).getTime())).toBe('18:30');
  });
});
