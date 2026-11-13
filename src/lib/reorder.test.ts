import { describe, expect, it } from 'vitest';
import { delayTask, saveForm, undelayTask } from './actions';
import { formFromTask } from './editor';
import { arrangeTasks, dropIndex, neighbors, reorderTask, shiftFor, timeGroup } from './reorder';
import { visibleTasks } from './sort';
import { applyToTasks } from './repeat';
import type { Task, TimeValue } from '../types';

const D = '2026-11-13';
const mk = (id: string, time: TimeValue, over: Partial<Task> = {}): Task => ({
  id, date: D, time, category: '待辦', title: id, note: '', done: false, delayDays: 0, createdAt: 1, updatedAt: 1, ...over,
});
const ids = (ts: Task[]) => ts.map((t) => t.id);
const apply = (all: Task[], a: ReturnType<typeof reorderTask>) => (a ? applyToTasks(all, a.changes) : all);

describe('時段', () => {
  it('上午與 0:00–11:59 一組、下午與 12:00–23:59 一組、不設時間自己一組', () => {
    expect(timeGroup('')).toBe(0);
    for (const t of ['上午', '00:00', '9:30', '11:59'] as TimeValue[]) expect(timeGroup(t)).toBe(1);
    for (const t of ['下午', '12:00', '18:00', '23:59'] as TimeValue[]) expect(timeGroup(t)).toBe(2);
  });
});

describe('排列', () => {
  const base = [mk('pm', '下午'), mk('a9', '09:00'), mk('n', ''), mk('am', '上午'), mk('p13', '13:00'), mk('a7', '07:00')];
  it('沒排過時就照時間', () => {
    expect(ids(arrangeTasks(base))).toEqual(['n', 'a7', 'a9', 'am', 'p13', 'pm']);
  });

  it('時段內可以任意排；不會跨時段', () => {
    let all = base;
    // 上午那組把「上午」拖到最前面
    all = apply(all, reorderTask(all, all.find((t) => t.id === 'am')!, null, 'a7', 5));
    expect(ids(arrangeTasks(all))).toEqual(['n', 'am', 'a7', 'a9', 'p13', 'pm']);
    // 下午那組把 13:00 放到「下午」後面
    all = apply(all, reorderTask(all, all.find((t) => t.id === 'p13')!, 'pm', null, 6));
    expect(ids(arrangeTasks(all))).toEqual(['n', 'am', 'a7', 'a9', 'pm', 'p13']);
  });

  it('之後新增的照時間插進已排過的順序裡', () => {
    let all = base;
    all = apply(all, reorderTask(all, all.find((t) => t.id === 'a9')!, null, 'a7', 5)); // a9, a7, am
    all = [...all, mk('a8', '08:00', { createdAt: 9 })];
    expect(ids(arrangeTasks(all).filter((t) => timeGroup(t.time) === 1))).toEqual(['a9', 'a7', 'a8', 'am']);
  });

  it('只回傳順序有變的；沒移動回傳 null', () => {
    const all = [mk('x', '09:00', { order: 1 }), mk('y', '10:00', { order: 2 })];
    expect(reorderTask(all, all[0], null, 'y', 5)).toBeNull();
    const a = reorderTask(all, all[0], 'y', null, 5)!;
    expect(a.changes.putTasks.map((t) => [t.id, t.order])).toEqual([['y', 1], ['x', 2]]);
    expect(a.message).toBe('已移動');
  });

  it('在分類篩選下拖動，其他分類的順序也一致（以全部事項排）', () => {
    const all = [mk('m1', '09:00', { category: '會議' }), mk('t1', '10:00'), mk('t2', '11:00')];
    // 待辦檢視只看到 t1, t2；把 t2 拖到 t1 前面
    const after = apply(all, reorderTask(all, all[2], null, 't1', 5));
    expect(ids(visibleTasks(after, D, '待辦'))).toEqual(['t2', 't1']);
    expect(ids(visibleTasks(after, D, '全部'))).toEqual(['m1', 't2', 't1']);
  });

  it('已完成、已刪除、別天的不參與', () => {
    const all = [mk('a', '09:00'), mk('b', '10:00'), mk('d', '08:00', { done: true }), mk('x', '08:00', { deletedAt: 1 }), mk('o', '08:00', { date: '2026-11-14' })];
    const a = reorderTask(all, all[1], null, 'a', 5)!;
    expect(a.changes.putTasks.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });
});

describe('換日期或時段就不再沿用順序', () => {
  const t = mk('a', '09:00', { order: 3 });
  it('延後、恢復', () => {
    expect(delayTask(t, 5).changes.putTasks[0].order).toBeUndefined();
    expect(undelayTask({ ...t, delayDays: 1 }, 5).changes.putTasks[0].order).toBeUndefined();
  });
  it('編輯：改時間或日期就拿掉，只改標題保留', () => {
    const f = formFromTask(t);
    expect(saveForm({ ...f, timeMode: '下午' }, t, 5, 'z')!.changes.putTasks[0].order).toBeUndefined();
    expect(saveForm({ ...f, date: '2026-11-14' }, t, 5, 'z')!.changes.putTasks[0].order).toBeUndefined();
    expect(saveForm({ ...f, timeVal: '10:30' }, t, 5, 'z')!.changes.putTasks[0].order).toBeUndefined(); // 改時間就照時間重排
    expect(saveForm({ ...f, title: '新' }, t, 5, 'z')!.changes.putTasks[0].order).toBe(3);
  });
});

describe('拖動的幾何', () => {
  const centers = [50, 130, 210, 290];
  it('落點', () => {
    expect(dropIndex(centers, 0, 30)).toBe(0);
    expect(dropIndex(centers, 0, 90)).toBe(1);
    expect(dropIndex(centers, 0, 500)).toBe(3);
    expect(dropIndex(centers, 3, -170)).toBe(1);
    expect(dropIndex(centers, 2, 0)).toBe(2);
  });
  it('讓位', () => {
    expect([0, 1, 2, 3].map((j) => shiftFor(j, 0, 2, 80))).toEqual([0, -80, -80, 0]);
    expect([0, 1, 2, 3].map((j) => shiftFor(j, 3, 1, 80))).toEqual([0, 80, 80, 0]);
  });
  it('鄰居', () => {
    expect(neighbors(['a', 'b', 'c'], 0, 2)).toEqual({ prevId: 'c', nextId: null });
    expect(neighbors(['a', 'b', 'c'], 2, 0)).toEqual({ prevId: null, nextId: 'a' });
    expect(neighbors(['a', 'b', 'c'], 2, 1)).toEqual({ prevId: 'a', nextId: null });
  });
});
