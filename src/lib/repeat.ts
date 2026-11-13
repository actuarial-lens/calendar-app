import type { Action, Changes } from './changes';
import { emptyChanges } from './changes';
import { addDays, parseISO, pad2 } from './dates';
import type { EditorForm } from './editor';
import { formTime } from './editor';
import type { Category, Repeat, RepeatFreq, SeriesTpl, Task, TimeValue } from '../types';

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
  for (const last of latest.values()) {
    const r = last.repeat!;
    // 整組的設定存在 repeat.tpl；舊資料沒有才看最後一筆
    const tpl = r.tpl ?? tplOf(last);
    const after = r.occurrence > addDays(today, -1) ? r.occurrence : addDays(today, -1);
    for (const d of occurrenceDates(r.anchor, r.freq, after, horizon, r.until)) {
      added.push({
        id: newId(),
        date: d,
        time: tpl.time,
        category: tpl.category,
        title: tpl.title,
        note: last.note,
        ...(tpl.leadMinutes !== undefined ? { leadMinutes: tpl.leadMinutes } : {}),
        // 「重要」看整組的設定，不看範本那一筆（範本可能是「僅限這次」改過的）
        ...(r.important ? { important: true } : {}),
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

/** 編輯中的事項原本的樣子（新增時為 null）：用來決定重複的起始日 */
export type RepeatOrigin = Pick<Task, 'date' | 'repeat'> | null;

/**
 * 重複的起始日：沒在面板改日期時沿用原本的（被延後、或月底順延的那一筆，不會讓整組的日子跑掉）；
 * 換了頻率就以這一筆原定的日期為準；改了日期或原本不重複，就用表單上的日期。
 */
export function repeatStart(origin: RepeatOrigin, form: Pick<EditorForm, 'repeat' | 'date'>): { anchor: string; occurrence: string } {
  const r = origin?.repeat;
  if (!r || origin!.date !== form.date) return { anchor: form.date, occurrence: form.date };
  return { anchor: r.freq === form.repeat ? r.anchor : r.occurrence, occurrence: r.occurrence };
}

/** 表單目前的重複設定 → Repeat（不重複時回傳 undefined） */
export function repeatFromForm(form: Pick<EditorForm, 'repeat' | 'until' | 'date'>, seriesId: string, origin: RepeatOrigin = null): Repeat | undefined {
  if (form.repeat === 'none') return undefined;
  const start = repeatStart(origin, form);
  const until = form.until && form.until >= start.occurrence ? form.until : undefined;
  return { seriesId, freq: form.repeat, ...start, ...(until ? { until } : {}) };
}

/** 這組重複在編輯面板上有沒有被改動（直接比原本的結束日，不依日期修正，已結束的才不會被當成改過） */
export function repeatChanged(existing: Task, form: Pick<EditorForm, 'repeat' | 'until' | 'date'>): boolean {
  const old = existing.repeat;
  const oldFreq = old ? old.freq : 'none';
  if (oldFreq !== form.repeat) return true;
  if (!old) return false;
  return (old.until ?? '') !== form.until;
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

/** 依 important 設定或拿掉欄位（false 時不留欄位） */
export function setImportant<T extends { important?: boolean }>(x: T, important: boolean): T {
  const { important: _i, ...rest } = x;
  return (important ? { ...rest, important: true } : rest) as T;
}

/** 一筆事項的標題、時間、分類、提前提醒 → 整組的範本 */
export function tplOf(t: Pick<Task, 'title' | 'time' | 'category' | 'leadMinutes'>): SeriesTpl {
  return { title: t.title, time: t.time, category: t.category, ...(t.leadMinutes !== undefined ? { leadMinutes: t.leadMinutes } : {}) };
}

/** 整組目前的範本：有存就用存的；舊資料沒有就和 planRepeats 一樣看原定日期最晚的那一筆 */
export function currentTpl(all: Task[], t: Task): SeriesTpl {
  if (t.repeat?.tpl) return t.repeat.tpl;
  let last = t;
  for (const x of all) if (x.repeat?.seriesId === t.repeat?.seriesId && x.repeat!.occurrence > last.repeat!.occurrence) last = x;
  return last.repeat?.tpl ?? tplOf(last);
}

/** 編輯面板上改了哪些整組可共用的欄位（只放有改的；lead: null = 改回跟隨預設） */
export interface TplPatch {
  title?: string;
  time?: TimeValue;
  category?: Category;
  lead?: number | null;
}

export function tplPatch(existing: Task, form: EditorForm): TplPatch {
  const p: TplPatch = {};
  const title = form.title.trim();
  const time = formTime(form);
  if (title && title !== existing.title) p.title = title;
  if (time !== existing.time) p.time = time;
  if (form.category !== existing.category) p.category = form.category;
  if (form.lead !== (existing.leadMinutes ?? null)) p.lead = form.lead;
  return p;
}

export const isEmptyPatch = (p: TplPatch) => Object.keys(p).length === 0;

/** 存檔前要不要問「僅限這次／未來每一次」：已存在的重複事項、沒改重複設定、改了標題／時間／分類／提前提醒 */
export function needsEditScope(existing: Task | undefined, form: EditorForm): boolean {
  if (!existing?.repeat || form.mode !== 'edit') return false;
  if (repeatChanged(existing, form)) return false;
  return !isEmptyPatch(tplPatch(existing, form));
}

/** 把改動套到一筆事項或範本上（時間改了，手動排的順序也拿掉） */
export function applyPatch<T extends Task | SeriesTpl>(x: T, p: TplPatch): T {
  let out = { ...x } as T & { order?: number };
  if (p.title !== undefined) out.title = p.title;
  if (p.category !== undefined) out.category = p.category;
  if (p.time !== undefined && p.time !== out.time) {
    out.time = p.time;
    delete out.order;
  }
  if (p.lead !== undefined) {
    const { leadMinutes: _l, ...rest } = out;
    out = (p.lead === null ? rest : { ...rest, leadMinutes: p.lead }) as T;
  }
  return out;
}

/**
 * 「未來每一次」：同一組裡原定日期在 t 之後的每一筆，整組設定都改掉（之後新排的會跟著），
 * 其中還沒完成、沒被刪掉的那些，卡片內容也一起改。t 自己不在回傳裡。
 * important：要改「重要」時給；patch + tpl：要改標題／時間／分類／提前提醒時給（tpl 是改完的整組範本）。
 */
export function editFuture(all: Task[], t: Task, opts: { important?: boolean; patch?: TplPatch; tpl?: SeriesTpl }, now: number): Task[] {
  const r = t.repeat!;
  const out: Task[] = [];
  for (const x of all) {
    if (x.repeat?.seriesId !== r.seriesId || x.id === t.id || x.repeat.occurrence < r.occurrence) continue;
    const live = !x.done && !x.deletedAt;
    let next: Task = x;
    let rep: Repeat = x.repeat;
    if (opts.important !== undefined) {
      if (live) next = setImportant(next, opts.important);
      rep = setImportant(rep, opts.important);
    }
    if (opts.patch && opts.tpl) {
      if (live) next = applyPatch(next, opts.patch);
      rep = { ...rep, tpl: opts.tpl };
    }
    out.push({ ...next, repeat: rep, updatedAt: now });
  }
  return out;
}

export function importantForFuture(all: Task[], t: Task, important: boolean, now: number): Task[] {
  return editFuture(all, t, { important }, now);
}
