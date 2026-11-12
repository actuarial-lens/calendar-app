import { describe, expect, it } from 'vitest';
import { fromWheel, minuteOptions, toWheel } from './wheel';

describe('滾輪時間轉換', () => {
  it('24 小時 ↔ 上午／下午 12 小時', () => {
    expect(toWheel('00:00')).toEqual({ meridiem: '上午', hour12: 12, minute: 0 });
    expect(toWheel('09:30')).toEqual({ meridiem: '上午', hour12: 9, minute: 30 });
    expect(toWheel('12:00')).toEqual({ meridiem: '下午', hour12: 12, minute: 0 });
    expect(toWheel('15:05')).toEqual({ meridiem: '下午', hour12: 3, minute: 5 });
    expect(toWheel('23:55')).toEqual({ meridiem: '下午', hour12: 11, minute: 55 });
  });
  it('來回轉換不變', () => {
    for (let h = 0; h < 24; h++) for (const m of [0, 5, 30, 55]) {
      const hm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      expect(fromWheel(toWheel(hm))).toBe(hm);
    }
  });
  it('格式不對當作 09:00', () => {
    expect(fromWheel(toWheel(''))).toBe('09:00');
  });
  it('分鐘欄：不是 5 的倍數時多一格', () => {
    expect(minuteOptions(30)).toHaveLength(12);
    expect(minuteOptions(7)).toHaveLength(13);
    expect(minuteOptions(7)).toContain(7);
  });
});
