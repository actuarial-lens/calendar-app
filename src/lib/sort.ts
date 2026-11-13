import type { Note, Tag, Task, TimeValue } from '../types';
import { arrangeTasks } from './reorder';

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
  return arrangeTasks(
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

/** 週列／月曆的顏色深淺：0 = 空（沒有未完成事項；只有隨手記也算空）、1 = 1–2 件、2 = 3–4 件、3 = 5 件以上 */
export type LoadLevel = 0 | 1 | 2 | 3;

export function loadLevel(count: number): LoadLevel {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  return 3;
}

/** 每一天未完成（未刪除）的事項件數；隨手記不算 */
export function dayCounts(tasks: Task[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tasks) if (!t.deletedAt && !t.done) m.set(t.date, (m.get(t.date) ?? 0) + 1);
  return m;
}
