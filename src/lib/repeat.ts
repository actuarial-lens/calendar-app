import type { Action, Changes } from './changes';
import { emptyChanges } from './changes';
import { addDays, parseISO, pad2 } from './dates';
import type { EditorForm } from './editor';
import type { Repeat, RepeatFreq, Task } from '../types';

/** 一次最多往後排到幾天之後；每週約 9 筆、每月約 2 筆 */
export const REPEAT_HORIZON_DAYS = 60;

export const REPEAT_LABEL: Record<RepeatFreq, string> = { weekly: '每週', monthly: '每月' };

function daysInMonth(y: number, m0: number): number {
  return new Date(y, m0 + 1, 0).getDate();
}

/**
 * 重複的日期（只回傳 after 之後、to 之前（含）、且不超過 until 的）。
 * 每週：起始日加 7 的倍數。每月：每個月的同一個「幾號」，沒有那天就用月底（31 號 → 2 月 28／29 日）。
 */
export function occurrenceDates(anchor: string, freq: RepeatFreq, after: string, to: string, until?: string): string[] {
  const end = until && until < to ? until : to;
  const out: string[] = [];
  if (freq === 'weekly') {
    let d = anchor;
    // 直接跳到 after 附近，不要從很久以前一步步算
    if (d <= after) {
      const gap = Math.floor((parseISO(after).getTime() - parseISO(d).getTime()) / 86400000);
      d = addDays(d, Math.floor(gap / 7) * 7);
    }
    for (; d <= end; d = addDays(d, 7)) if (d > after) out.push(d);
    return out;
  }
  const a = parseISO(anchor);
  const day = a.getDate();
  let y = a.getFullYear();
  let m = a.getMonth();
  for (let i = 0; i < 2400; i++) {
    const iso = `${y}-${pad2(m + 1)}-${pad2(Math.min(day, daysInMonth(y, m)))}`;
    if (iso > end) break;
    if (iso > after) out.push(iso);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

/**
 * 補上該排的重複事項：每一組以「原定日期最晚的那一筆」當範本（被刪掉的也算，這樣不會把刪掉的又排回來），
 * 往後排到 今天 + 60 天，只排今天以後的，結束日期過了就不排。
 */
export function planRepeats(tasks: Task[], today: string, now: number, newId: () => string): Task[] {
  const latest = new Map<string, Task>();
  for (const t of tasks) {
    if (!t.repeat) continue;
    const cur = latest.get(t.repeat.seriesId);
    if (!cur || t.repeat.occurrence > cur.repeat!.occurrence) latest.set(t.repeat.seriesId, t);
  }
  const horizon = addDays(today, REPEAT_HORIZON_DAYS);
  const added: Task[] = [];
  for (const tpl of latest.values()) {
    const r = tpl.repeat!;
    const after = r.occurrence > addDays(today, -1) ? r.occurrence : addDays(today, -1);
    for (const d of occurrenceDates(r.anchor, r.freq, after, horizon, r.until)) {
      added.push({
        id: newId(),
        date: d,
        time: tpl.time,
        category: tpl.category,
        title: tpl.title,
        note: tpl.note,
        ...(tpl.leadMinutes !== undefined ? { leadMinutes: tpl.leadMinutes } : {}),
        done: false,
        delayDays: 0,
        createdAt: now + added.length, // 保持固定順序
        updatedAt: now,
        repeat: { ...r, occurrence: d },
      });
    }
  }
  return added;
}

/** 把一組變更套用到事項清單上（只用來預先算出結果，不碰資料庫） */
export function applyToTasks(tasks: Task[], c: Changes): Task[] {
  const map = new Map(tasks.map((t) => [t.id, t]));
  for (const id of c.delTaskIds) map.delete(id);
  for (const t of c.putTasks) map.set(t.id, t);
  return [...map.values()];
}

/** 動作做完之後，連同該補排的重複事項一起存（這樣復原時會一起拿掉） */
export function withRepeats(a: Action, tasks: Task[], today: string, now: number, newId: () => string): Action {
  const added = planRepeats(applyToTasks(tasks, a.changes), today, now, newId);
  if (!added.length) return a;
  return { ...a, changes: { ...a.changes, putTasks: [...a.changes.putTasks, ...added] } };
}

/** 表單目前的重複設定 → Repeat（不重複時回傳 undefined） */
export function repeatFromForm(form: Pick<EditorForm, 'repeat' | 'until' | 'date'>, seriesId: string): Repeat | undefined {
  if (form.repeat === 'none') return undefined;
  const until = form.until && form.until >= form.date ? form.until : undefined;
  return { seriesId, freq: form.repeat, anchor: form.date, occurrence: form.date, ...(until ? { until } : {}) };
}

/** 這組重複在編輯面板上有沒有被改動 */
export function repeatChanged(existing: Task, form: Pick<EditorForm, 'repeat' | 'until' | 'date'>): boolean {
  const old = existing.repeat;
  const oldFreq = old ? old.freq : 'none';
  if (oldFreq !== form.repeat) return true;
  if (!old) return false;
  const newUntil = form.until && form.until >= form.date ? form.until : '';
  return (old.until ?? '') !== newUntil;
}

/**
 * 結束整組重複：這一筆之後（原定日期較晚）還沒完成的都軟刪除，
 * 而且整組都記上結束日期，不會再排新的。
 */
export function endSeries(all: Task[], t: Task, now: number, deleteFutureFrom: string | null): Task[] {
  const r = t.repeat!;
  const until = addDays(deleteFutureFrom ?? r.occurrence, -1);
  const out: Task[] = [];
  for (const x of all) {
    if (x.repeat?.seriesId !== r.seriesId || x.id === t.id) continue;
    const drop = deleteFutureFrom !== null && !x.deletedAt && !x.done && x.repeat.occurrence >= deleteFutureFrom;
    out.push({ ...x, ...(drop ? { deletedAt: now } : {}), repeat: { ...x.repeat, until }, updatedAt: now });
  }
  return out;
}

/** 刪掉所有重複：這組還沒完成的全部軟刪除（已完成的留作紀錄），並且不再排新的 */
export function deleteSeries(all: Task[], t: Task, now: number): Action {
  const r = t.repeat!;
  const until = addDays(r.occurrence, -3650); // 一定早於任何一筆，不會再排
  const put: Task[] = [];
  let n = 0;
  for (const x of all) {
    if (x.repeat?.seriesId !== r.seriesId) continue;
    const drop = !x.deletedAt && !x.done;
    if (drop) n += 1;
    put.push({ ...x, ...(drop ? { deletedAt: now } : {}), repeat: { ...x.repeat, until }, updatedAt: now });
  }
  return { changes: { ...emptyChanges(), putTasks: put }, message: `已刪除 ${n} 筆重複事項` };
}

/** 面板上的提示：這個設定實際會排在哪幾天 */
export function repeatHint(freq: RepeatFreq, date: string): string {
  const d = parseISO(date);
  if (freq === 'weekly') return `每${'日一二三四五六'[d.getDay()]}重複`;
  const day = d.getDate();
  return day > 28 ? `每月 ${day} 日重複，沒有那天的月份改在月底` : `每月 ${day} 日重複`;
}
