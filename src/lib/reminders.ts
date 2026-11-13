import { DEFAULT_SETTINGS, type Settings, type Task } from '../types';
import { addDays, dayLabel, toISO } from './dates';
import { sortTasks } from './sort';

export type ReminderKind = 'lead' | 'morning';

export interface Reminder {
  /** 同一個提醒永遠是同一個 id，用來避免重複發送。時間、日期、提前分鐘數改了就會是新的 id。 */
  id: string;
  kind: ReminderKind;
  at: number; // 該響的時間（ms）
  date: string; // 點通知要跳到哪一天
  title: string;
  body: string;
  taskId?: string;
}

export const MINUTE = 60_000;
/** 比現在早不到這麼久的提醒，算「剛剛才到」，可以直接跳通知；更早的算「錯過」 */
export const LIVE_WINDOW_MS = 2 * MINUTE;

const HM = /^(\d{1,2}):(\d{2})$/;

/** 'YYYY-MM-DD' + 'HH:mm' → 本地時間的 ms；格式不對回傳 null（例如「上午」「下午」「不設時間」） */
export function atLocal(date: string, hm: string): number | null {
  const m = HM.exec(hm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(y, mo - 1, d, h, min).getTime();
}

/** 指定時間的事項：在「時間 − 提前分鐘」提醒。沒有指定時間的事項不會有這種提醒。 */
export function leadReminderAt(task: Pick<Task, 'date' | 'time'>, leadMinutes: number): number | null {
  const t = atLocal(task.date, task.time);
  return t === null ? null : t - leadMinutes * MINUTE;
}

function leadReminder(t: Task, settings: Settings): Reminder | null {
  const lead = t.leadMinutes ?? settings.leadMinutes;
  const at = leadReminderAt(t, lead);
  if (at === null) return null;
  return {
    id: `lead:${t.id}:${t.date}:${t.time}:${lead}`,
    kind: 'lead',
    at,
    date: t.date,
    taskId: t.id,
    title: t.title,
    body: `${dayLabel(t.date)} ${t.time}`,
  };
}

/**
 * 「來不及」的提前提醒：該響的時間在 from 之前就過了（例如距離開始不到提前分鐘才新增、或改了時間／提前分鐘），
 * 但事項還沒開始。這些要馬上提醒一次，所以 at 改成 now。
 */
export function lateLeadReminders(tasks: Task[], settings: Settings, from: number, now: number): Reminder[] {
  const out: Reminder[] = [];
  for (const t of tasks) {
    if (t.deletedAt || t.done) continue;
    const r = leadReminder(t, settings);
    const start = atLocal(t.date, t.time);
    if (r && start !== null && r.at <= from && start > now) out.push({ ...r, at: now });
  }
  return out;
}

const PREVIEW_COUNT = 3;

function morningReminder(date: string, day: Task[], settings: Settings, at: number): Reminder {
  const titles = day.slice(0, PREVIEW_COUNT).map((t) => t.title);
  return {
    id: `morning:${date}:${settings.morningTime}`,
    kind: 'morning',
    at,
    date,
    title: `今天還有 ${day.length} 件事`,
    body: titles.join('、') + (day.length > PREVIEW_COUNT ? '…' : ''),
  };
}

/**
 * 算出落在 (from, to] 之間的所有提醒：
 * - 每個「指定時間、未完成、未刪除」的事項一個
 * - 每天早上 morningTime 一個「今天還有 N 件事」（那天沒有未完成事項就不提醒）
 * 提醒是由目前的事項資料算出來的，所以改時間、延後、完成、刪除之後重算，結果自然跟著變。
 */
export function buildReminders(tasks: Task[], settings: Settings, from: number, to: number): Reminder[] {
  const out: Reminder[] = [];
  const open = tasks.filter((t) => !t.deletedAt && !t.done);

  for (const t of open) {
    const r = leadReminder(t, settings);
    if (r && r.at > from && r.at <= to) out.push(r);
  }

  const last = toISO(new Date(to));
  for (let d = toISO(new Date(from)); d <= last; d = addDays(d, 1)) {
    if (!settings.morningEnabled) break;
    const at = atLocal(d, settings.morningTime) ?? atLocal(d, DEFAULT_SETTINGS.morningTime)!;
    if (at <= from || at > to) continue;
    const day = sortTasks(open.filter((t) => t.date === d));
    if (day.length > 0) out.push(morningReminder(d, day, settings, at));
  }

  return out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
}

/** 把「該響、還沒發過」的提醒分成：剛剛才到（live）和更早就該響的（missed） */
export function splitDue(due: Reminder[], now: number, liveWindow = LIVE_WINDOW_MS): { live: Reminder[]; missed: Reminder[] } {
  const live: Reminder[] = [];
  const missed: Reminder[] = [];
  for (const r of due) (r.at >= now - liveWindow ? live : missed).push(r);
  return { live, missed };
}
