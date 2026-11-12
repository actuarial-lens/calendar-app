import type { Action } from './changes';
import { emptyChanges } from './changes';
import { compareTasks, sortKey } from './sort';
import type { Task, TimeValue } from '../types';

/** 能互相換位置的時段：0 = 不設時間、1 = 上午與 00:00–11:59、2 = 下午與 12:00–23:59 */
export type TimeGroup = 0 | 1 | 2;

export function timeGroup(time: TimeValue): TimeGroup {
  if (time === '') return 0;
  if (time === '上午') return 1;
  if (time === '下午') return 2;
  return sortKey(time) < '12:00' ? 1 : 2;
}

/**
 * 一天內的顯示順序：先依時段（不設時間 → 上午 → 下午），
 * 時段內被手動排過的（有 order）照 order；還沒排過的照時間插進去：放在最後一個時間不比它晚的後面（都比它晚就放最前面）。
 */
export function arrangeTasks(tasks: Task[]): Task[] {
  const out: Task[] = [];
  for (const g of [0, 1, 2] as const) {
    const inGroup = tasks.filter((t) => timeGroup(t.time) === g);
    const list = inGroup.filter((t) => t.order !== undefined).sort((a, b) => a.order! - b.order! || compareTasks(a, b));
    for (const t of inGroup.filter((x) => x.order === undefined).sort(compareTasks)) {
      const k = sortKey(t.time);
      let i = list.length;
      while (i > 0 && sortKey(list[i - 1].time) > k) i--;
      list.splice(i, 0, t);
    }
    out.push(...list);
  }
  return out;
}

/**
 * 把 moved 放到 prevId 的後面（prevId 為 null 就放到 nextId 前面）。
 * 只動同一天、同一時段、還沒完成的事項（其他分類的也算在內，切換分類時順序才一致）；
 * 整個時段重新編號，只回傳順序有變的。
 */
export function reorderTask(all: Task[], moved: Task, prevId: string | null, nextId: string | null, now: number): Action | null {
  const g = timeGroup(moved.time);
  const group = arrangeTasks(all.filter((t) => !t.deletedAt && !t.done && t.date === moved.date && timeGroup(t.time) === g));
  const rest = group.filter((t) => t.id !== moved.id);
  let at = 0;
  if (prevId !== null) at = rest.findIndex((t) => t.id === prevId) + 1;
  else if (nextId !== null) at = Math.max(0, rest.findIndex((t) => t.id === nextId));
  const self = group.find((t) => t.id === moved.id) ?? moved;
  rest.splice(at, 0, self);
  if (rest.every((t, i) => t.id === group[i].id)) return null; // 位置沒變
  const putTasks = rest.flatMap((t, i) => (t.order === i + 1 ? [] : [{ ...t, order: i + 1, updatedAt: now }]));
  if (!putTasks.length) return null;
  return { changes: { ...emptyChanges(), putTasks }, message: '已移動' };
}

/** 換了日期或時段，原本的手動順序就不適用了 */
export function dropOrder(t: Task): Task {
  const { order: _o, ...rest } = t;
  return rest;
}

/**
 * 拖動中：被拖的那張（原本第 from 張）往下移了 dy，應該落在第幾個位置。
 * centers：同一時段每張卡片的中心點（畫面座標，依顯示順序）。
 */
export function dropIndex(centers: number[], from: number, dy: number): number {
  const c = centers[from] + dy;
  let to = from;
  for (let j = from + 1; j < centers.length && c > centers[j]; j++) to = j;
  for (let j = from - 1; j >= 0 && c < centers[j]; j--) to = j;
  return to;
}

/** 拖動中，第 j 張要讓位多少（pitch = 被拖那張的高度加間距） */
export function shiftFor(j: number, from: number, to: number, pitch: number): number {
  if (j === from) return 0;
  if (from < to && j > from && j <= to) return -pitch;
  if (to < from && j >= to && j < from) return pitch;
  return 0;
}

/** 依新的位置算出要放在誰後面／前面 */
export function neighbors(ids: string[], from: number, to: number): { prevId: string | null; nextId: string | null } {
  const rest = ids.filter((_, i) => i !== from);
  return { prevId: to > 0 ? rest[to - 1] : null, nextId: to > 0 ? null : (rest[0] ?? null) };
}
