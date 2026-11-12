import type { Note, Tag, Task, TimeValue } from '../types';

const HM = /^\d{1,2}:\d{2}$/;

/** 同一天內的排序鍵：不設時間最前；上午視為 11:58、下午視為 17:58 */
export function sortKey(time: TimeValue): string {
  if (HM.test(time)) return time.padStart(5, '0');
  if (time === '上午') return '11:58';
  if (time === '下午') return '17:58';
  return '00:00';
}

export function compareTasks(a: Task, b: Task): number {
  const ka = sortKey(a.time);
  const kb = sortKey(b.time);
  if (ka !== kb) return ka < kb ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export const sortTasks = (tasks: Task[]): Task[] => [...tasks].sort(compareTasks);

/** 某一天、某個分類要顯示的事項（已排序、不含已刪除） */
export function visibleTasks(tasks: Task[], day: string, tag: Tag): Task[] {
  return sortTasks(
    tasks.filter(
      (t) =>
        !t.deletedAt &&
        t.date === day &&
        (tag === '已完成' ? t.done : !t.done && (tag === '全部' || t.category === tag)),
    ),
  );
}

/** 某一天的隨手記（新的在最下面，不含已刪除） */
export function visibleNotes(notes: Note[], day: string): Note[] {
  return notes
    .filter((n) => !n.deletedAt && n.date === day)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

/** 週列／月曆的小點：有未完成事項或隨手記 */
export function hasContent(iso: string, tasks: Task[], notes: Note[]): boolean {
  return (
    tasks.some((t) => !t.deletedAt && !t.done && t.date === iso) ||
    notes.some((n) => !n.deletedAt && n.date === iso)
  );
}
