import { describe, expect, it } from 'vitest';
import type { Note, Task } from '../types';
import { dayCounts, loadLevel, sortKey, sortTasks, visibleNotes, visibleTasks } from './sort';

const task = (p: Partial<Task> & { id: string }): Task => ({
  date: '2026-11-10',
  time: '',
  category: '待辦',
  title: p.id,
  note: '',
  done: false,
  delayDays: 0,
  createdAt: 1,
  updatedAt: 1,
  ...p,
});
const note = (p: Partial<Note> & { id: string }): Note => ({
  date: '2026-11-10',
  text: p.id,
  createdAt: 1,
  updatedAt: 1,
  ...p,
});

describe('sortKey', () => {
  it('上午 11:58、下午 17:58、不設 00:00、指定補零', () => {
    expect(sortKey('上午')).toBe('11:58');
    expect(sortKey('下午')).toBe('17:58');
    expect(sortKey('')).toBe('00:00');
    expect(sortKey('9:05')).toBe('09:05');
    expect(sortKey('14:00')).toBe('14:00');
  });
});

describe('sortTasks', () => {
  it('不設時間最前，其餘依時間先後，上午在中午前、下午在傍晚前', () => {
    const list = [
      task({ id: 'a', time: '18:30' }),
      task({ id: 'b', time: '下午' }),
      task({ id: 'c', time: '14:00' }),
      task({ id: 'd', time: '' }),
      task({ id: 'e', time: '上午' }),
      task({ id: 'f', time: '12:00' }),
      task({ id: 'g', time: '09:30' }),
      task({ id: 'h', time: '17:59' }),
    ];
    expect(sortTasks(list).map((t) => t.id)).toEqual(['d', 'g', 'e', 'f', 'c', 'b', 'h', 'a']);
  });

  it('同一時間以建立先後排，順序固定', () => {
    const list = [
      task({ id: 'x2', time: '10:00', createdAt: 20 }),
      task({ id: 'x1', time: '10:00', createdAt: 10 }),
    ];
    expect(sortTasks(list).map((t) => t.id)).toEqual(['x1', 'x2']);
  });

  it('9:30 排在 10:00 前（不被字串長度影響）', () => {
    const list = [task({ id: 'a', time: '10:00' }), task({ id: 'b', time: '9:30' })];
    expect(sortTasks(list).map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('不改動原本的陣列', () => {
    const list = [task({ id: 'a', time: '10:00' }), task({ id: 'b', time: '09:00' })];
    sortTasks(list);
    expect(list.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('visibleTasks', () => {
  const list = [
    task({ id: 'm', category: '會議', time: '10:00' }),
    task({ id: 't', category: '待辦', time: '11:00' }),
    task({ id: 'p', category: '私人', time: '12:00' }),
    task({ id: 'done', category: '待辦', done: true }),
    task({ id: 'gone', category: '待辦', deletedAt: 5 }),
    task({ id: 'other', date: '2026-11-11' }),
  ];
  it('全部 = 當天未完成、未刪除', () => {
    expect(visibleTasks(list, '2026-11-10', '全部').map((t) => t.id)).toEqual(['m', 't', 'p']);
  });
  it('分類只看該分類的未完成', () => {
    expect(visibleTasks(list, '2026-11-10', '會議').map((t) => t.id)).toEqual(['m']);
    expect(visibleTasks(list, '2026-11-10', '私人').map((t) => t.id)).toEqual(['p']);
  });
  it('已完成只看當天已完成（不含已刪除）', () => {
    expect(visibleTasks(list, '2026-11-10', '已完成').map((t) => t.id)).toEqual(['done']);
    expect(visibleTasks([...list, task({ id: 'd2', done: true, deletedAt: 9 })], '2026-11-10', '已完成').map((t) => t.id)).toEqual(['done']);
  });
});

describe('visibleNotes / 週列深淺', () => {
  const notes = [
    note({ id: 'n2', createdAt: 20 }),
    note({ id: 'n1', createdAt: 10 }),
    note({ id: 'del', deletedAt: 1 }),
    note({ id: 'other', date: '2026-11-11' }),
  ];
  it('隨手記每天獨立，新的在下面', () => {
    expect(visibleNotes(notes, '2026-11-10').map((n) => n.id)).toEqual(['n1', 'n2']);
  });
  it('深淺：只算未完成、未刪除的事項，隨手記不算', () => {
    const c = dayCounts([
      task({ id: 'a', date: '2026-11-12' }),
      task({ id: 'b', date: '2026-11-12' }),
      task({ id: 'c', date: '2026-11-12', done: true }),
      task({ id: 'd', date: '2026-11-12', deletedAt: 1 }),
      task({ id: 'e', date: '2026-11-13' }),
    ]);
    expect(c.get('2026-11-12')).toBe(2);
    expect(c.get('2026-11-13')).toBe(1);
    expect(c.get('2026-11-10')).toBeUndefined(); // 只有隨手記的日子 → 空
  });
  it('分級：0 空、1–2、3–4、5 以上', () => {
    expect([0, 1, 2, 3, 4, 5, 12].map(loadLevel)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });
});
