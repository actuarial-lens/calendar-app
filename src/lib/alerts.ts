import type { Action } from './changes';
import { emptyChanges } from './changes';
import { addDays, diffDays } from './dates';
import { dropOrder } from './reorder';
import { compareTasks } from './sort';
import type { Task } from '../types';

/** 截止日提示看未來幾天（今天 + 7 天，含當天） */
export const DEADLINE_DAYS = 7;

export interface DeadlineItem {
  task: Task;
  expired: boolean; // 只看日期：日期早於今天才算過期，當天過了時間不算
}

export interface Alerts {
  overdue: Task[]; // 過去的重要未結
  deadlines: DeadlineItem[]; // 已過期的截止事項在最上面，接著是 7 天內的
}

const byDate = (a: Task, b: Task) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : compareTasks(a, b));

/**
 * 提示框的內容。
 * 過去重要未結：標了重要、日期在今天之前、未完成、未刪除、沒按過「不再通知」。
 * 截止：標了截止日、未完成、未刪除、日期不晚於今天 + 7 天（已過期的也列）。
 * 同時標重要與截止日且已過期的只列一次，放在「重要未結」；按過「不再通知」的兩段都不列。
 */
export function buildAlerts(tasks: Task[], today: string): Alerts {
  const live = tasks.filter((t) => !t.deletedAt && !t.done && !t.muteOverdue);
  const overdue = live.filter((t) => t.important && t.date < today).sort(byDate);
  const shown = new Set(overdue.map((t) => t.id));
  const last = addDays(today, DEADLINE_DAYS);
  const deadlines = live
    .filter((t) => t.deadline && t.date <= last && !shown.has(t.id))
    .sort(byDate)
    .map((task) => ({ task, expired: task.date < today }));
  return { overdue, deadlines };
}

export const alertsEmpty = (a: Alerts) => a.overdue.length === 0 && a.deadlines.length === 0;

/** 標題列的摘要，例如「過去 2 件重要未結 · 7 天內 3 件截止 · 1 件已過期」 */
export function alertsSummary(a: Alerts): string {
  const parts: string[] = [];
  if (a.overdue.length) parts.push(`過去 ${a.overdue.length} 件重要未結`);
  const expired = a.deadlines.filter((d) => d.expired).length;
  const soon = a.deadlines.length - expired;
  if (soon) parts.push(`${DEADLINE_DAYS} 天內 ${soon} 件截止`);
  if (expired) parts.push(`${expired} 件已過期`);
  return parts.join(' · ');
}

/** 例如 11月20日 */
export function monthDay(iso: string): string {
  return `${Number(iso.slice(5, 7))}月${Number(iso.slice(8))}日`;
}

/**
 * 全部移至本日：日期改成今天，延後天數加上相差的天數，時間不動。
 * 這樣卡片會顯示「延 N 天」，也能用原本的「恢復」回到原來的日期。
 */
export function moveAllToToday(list: Task[], today: string, now: number): Action {
  const put = list
    .filter((t) => t.date < today)
    .map((t) => ({ ...dropOrder(t), date: today, delayDays: t.delayDays + diffDays(t.date, today), updatedAt: now }));
  return { changes: { ...emptyChanges(), putTasks: put }, message: `已將 ${put.length} 件移至今天` };
}

/** 不再通知：清單上這幾筆以後不再列（之後新出現的照樣會列） */
export function muteOverdue(list: Task[], now: number): Action {
  const put = list.map((t) => ({ ...t, muteOverdue: true, updatedAt: now }));
  return { changes: { ...emptyChanges(), putTasks: put }, message: `${put.length} 件不再通知` };
}
