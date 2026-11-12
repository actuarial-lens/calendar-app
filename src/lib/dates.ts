// 一律使用本地時區，日期字串格式 YYYY-MM-DD

export const WEEKDAYS_MON = ['一', '二', '三', '四', '五', '六', '日'] as const;
const WEEKDAYS_SUN = '日一二三四五六';

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(now: Date = new Date()): string {
  return toISO(now);
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toISO(new Date(y, m - 1, d + n));
}

/** b 比 a 晚幾天（b - a）。用 UTC 計算，不受日光節約影響。 */
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** 星期一 = 0 … 星期日 = 6 */
export function mondayIndex(iso: string): number {
  return (parseISO(iso).getDay() + 6) % 7;
}

export function weekStart(iso: string): string {
  return addDays(iso, -mondayIndex(iso));
}

export function weekDates(iso: string): string[] {
  const start = weekStart(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** 例如 2026.11.09 – 2026.11.15 */
export function rangeText(iso: string): string {
  const start = weekStart(iso);
  const dots = (s: string) => s.replace(/-/g, '.');
  return `${dots(start)} – ${dots(addDays(start, 6))}`;
}

/** 例如 11/12（四） */
export function dayLabel(iso: string): string {
  const d = parseISO(iso);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS_SUN[d.getDay()]}）`;
}

/** 月曆格：前面補 null 對齊星期一，month 為 0–11 */
export function monthCells(year: number, month: number): (string | null)[] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const total = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= total; d++) cells.push(`${year}-${pad2(month + 1)}-${pad2(d)}`);
  return cells;
}

/** 時間戳 → HH:mm（本地時間） */
export function formatHM(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
