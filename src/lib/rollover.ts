import type { Task } from '../types';
import { diffDays } from './dates';

/**
 * 沒做完自動延到今天：日期早於今天、未完成、未刪除的事項
 * → 日期改成今天，delayDays 加上相差的天數。只回傳有變動的事項。
 * （隨手記不會自動移動。）
 */
export function planRollover(tasks: Task[], today: string, now: number): Task[] {
  const changed: Task[] = [];
  for (const t of tasks) {
    if (t.deletedAt || t.done || t.date >= today) continue;
    changed.push({ ...t, date: today, delayDays: t.delayDays + diffDays(t.date, today), updatedAt: now });
  }
  return changed;
}
