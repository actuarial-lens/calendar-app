export type Meridiem = '上午' | '下午';

export interface WheelTime {
  meridiem: Meridiem;
  hour12: number; // 1–12
  minute: number; // 0–59
}

const HM = /^(\d{1,2}):(\d{2})$/;

/** 'HH:mm'（24 小時）→ 滾輪上的三個欄位。格式不對就當作 09:00。 */
export function toWheel(hm: string): WheelTime {
  const m = HM.exec(hm);
  const h = m ? Number(m[1]) % 24 : 9;
  const minute = m ? Math.min(59, Number(m[2])) : 0;
  return { meridiem: h < 12 ? '上午' : '下午', hour12: h % 12 || 12, minute };
}

/** 滾輪上的三個欄位 → 'HH:mm'（24 小時） */
export function fromWheel(w: WheelTime): string {
  const h = (w.hour12 % 12) + (w.meridiem === '下午' ? 12 : 0);
  return `${String(h).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
}

/** 分鐘欄：每 5 分鐘一格；如果目前的時間不是 5 的倍數（例如 09:07），把它也放進去才選得到 */
export function minuteOptions(current: number): number[] {
  const base = Array.from({ length: 12 }, (_, i) => i * 5);
  return base.includes(current) ? base : [...base, current].sort((a, b) => a - b);
}
