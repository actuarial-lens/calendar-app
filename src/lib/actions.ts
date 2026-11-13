import type { Action } from './changes';
import { emptyChanges } from './changes';
import { addDays, dayLabel } from './dates';
import type { EditorForm } from './editor';
import { formTime } from './editor';
import type { Note, Task } from '../types';
import { dropOrder } from './reorder';
import { endSeries, importantForFuture, repeatChanged, repeatFromForm, setImportant } from './repeat';

const withTask = (t: Task): Action['changes'] => ({ ...emptyChanges(), putTasks: [t] });
const withNote = (n: Note): Action['changes'] => ({ ...emptyChanges(), putNotes: [n] });

export function completeTask(t: Task, now: number): Action {
  return { changes: withTask({ ...t, done: true, doneAt: now, updatedAt: now }), message: '已完成' };
}

export function restoreTask(t: Task, now: number): Action {
  const { doneAt: _doneAt, ...rest } = t;
  return { changes: withTask({ ...rest, done: false, updatedAt: now }), message: '已恢復為未完成' };
}

/** 延後：日期加一天、delayDays + 1，保留原本的時間 */
export function delayTask(t: Task, now: number): Action {
  const date = addDays(t.date, 1);
  return {
    changes: withTask({ ...dropOrder(t), date, delayDays: t.delayDays + 1, updatedAt: now }),
    message: '已延到 ' + dayLabel(date),
  };
}

/** 恢復到原本設定的那天：日期往回推 delayDays 天，延後天數歸零（之後再延後會重新累計） */
export function undelayTask(t: Task, now: number): Action {
  const date = addDays(t.date, -t.delayDays);
  return {
    changes: withTask({ ...dropOrder(t), date, delayDays: 0, updatedAt: now }),
    message: '已恢復到 ' + dayLabel(date),
  };
}

/** 刪除一律是軟刪除 */
export function deleteTask(t: Task, now: number): Action {
  return { changes: withTask({ ...t, deletedAt: now, updatedAt: now }), message: '已刪除' };
}

export function delayNote(n: Note, now: number): Action {
  const date = addDays(n.date, 1);
  return { changes: withNote({ ...n, date, updatedAt: now }), message: '已延到 ' + dayLabel(date) };
}

export function deleteNote(n: Note, now: number): Action {
  return { changes: withNote({ ...n, deletedAt: now, updatedAt: now }), message: '已刪除' };
}

/** 轉待辦：同一天、不設時間、分類「待辦」，標題是隨手記內容；原本的隨手記移除 */
export function noteToTask(n: Note, now: number, newTaskId: string): Action {
  const task: Task = {
    id: newTaskId,
    date: n.date,
    time: '',
    category: '待辦',
    title: n.text,
    note: '',
    done: false,
    delayDays: 0,
    createdAt: now,
    updatedAt: now,
  };
  return {
    changes: { ...emptyChanges(), putTasks: [task], putNotes: [{ ...n, deletedAt: now, updatedAt: now }] },
    message: '已轉為待辦',
  };
}

/**
 * 儲存新增／編輯面板。事項是空的時候回傳 null（不能儲存）。
 * all：目前所有事項（改重複設定時要找出同一組的其他筆）；newSeriesId：需要新開一組重複時用的 id。
 */
export function saveForm(
  form: EditorForm,
  existing: Task | undefined,
  now: number,
  newTaskId: string,
  all: Task[] = [],
  newSeriesId: string = newTaskId,
): Action | null {
  const title = form.title.trim();
  if (!title) return null;
  const time = formTime(form);
  if (form.mode === 'new' || !existing) {
    const task: Task = {
      id: newTaskId,
      date: form.date,
      time,
      category: form.category,
      title,
      note: '',
      done: false,
      delayDays: 0,
      createdAt: now,
      updatedAt: now,
      ...(form.lead !== null ? { leadMinutes: form.lead } : {}),
      ...(form.important ? { important: true } : {}),
      // 新的重複事項：整組都跟著這一筆的「重要」
      ...(form.repeat !== 'none' ? { repeat: setImportant(repeatFromForm(form, newSeriesId)!, form.important) } : {}),
    };
    return { changes: withTask(task), message: '已新增到 ' + dayLabel(form.date) };
  }
  const moved = existing.date !== form.date;
  // 自己改了日期就當作重新安排，不再算「延後」
  // 換了日期或時段，手動排的順序不再適用
  // 時間改了也拿掉：讓它照新的時間重新插入
  const regrouped = moved || existing.time !== time;
  const { leadMinutes: _lead, ...existingRest } = regrouped ? dropOrder(existing) : existing;
  let base: Task = setImportant({ ...existingRest, ...(form.lead !== null ? { leadMinutes: form.lead } : {}), title, date: form.date, time, category: form.category, updatedAt: now, ...(moved ? { delayDays: 0 } : {}) }, form.important);
  const message = moved ? '已移到 ' + dayLabel(form.date) : '已更新';
  // 重複事項選了「未來每一次」：整組設定跟著改；「僅限這次」只改這一筆，整組設定不動
  const future = !!existing.repeat && form.importantScope === 'future';
  if (!repeatChanged(existing, form)) {
    if (!future) return { changes: withTask(base), message };
    base = { ...base, repeat: setImportant(existing.repeat!, form.important) };
    return { changes: { ...emptyChanges(), putTasks: [base, ...importantForFuture(all, existing, form.important, now)] }, message };
  }

  // 重複設定改了：這一筆另開一組新的（或變成不重複），舊的那組在這一筆之前結束、之後還沒做的拿掉
  const { repeat: _old, ...plain } = base;
  const fresh = repeatFromForm(form, newSeriesId, existing);
  // 新開的一組：原本是重複且選「僅限這次」就沿用舊組的設定，否則跟著這一筆
  const seriesImportant = existing.repeat && !future ? !!existing.repeat.important : form.important;
  const rep = fresh && setImportant(fresh, seriesImportant);
  const putTasks: Task[] = [rep ? { ...plain, repeat: rep } : plain];
  if (existing.repeat) putTasks.push(...endSeries(all, existing, now, existing.repeat.occurrence));
  return { changes: { ...emptyChanges(), putTasks }, message };
}
