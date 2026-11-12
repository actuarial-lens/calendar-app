import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { planRollover } from './rollover';

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
const NOW = 999;

describe('planRollover（沒做完自動延到今天）', () => {
  it('昨天沒做完 → 今天，延 1 天', () => {
    const [t] = planRollover([task({ id: 'a', date: '2026-11-09' })], '2026-11-10', NOW);
    expect(t).toMatchObject({ id: 'a', date: '2026-11-10', delayDays: 1, updatedAt: NOW });
  });

  it('delayDays 累加相差的天數（已有延後的也算）', () => {
    const [t] = planRollover([task({ id: 'a', date: '2026-11-07', delayDays: 2 })], '2026-11-10', NOW);
    expect(t).toMatchObject({ date: '2026-11-10', delayDays: 5 });
  });

  it('跨月、跨年也能算對天數', () => {
    const [t] = planRollover([task({ id: 'a', date: '2026-12-30' })], '2027-01-02', NOW);
    expect(t).toMatchObject({ date: '2027-01-02', delayDays: 3 });
  });

  it('保留原本的時間、分類、標題', () => {
    const [t] = planRollover([task({ id: 'a', date: '2026-11-09', time: '14:00', category: '會議', title: 'x' })], '2026-11-10', NOW);
    expect(t).toMatchObject({ time: '14:00', category: '會議', title: 'x' });
  });

  it('今天、未來、已完成、已刪除的都不動', () => {
    const list = [
      task({ id: 'today', date: '2026-11-10' }),
      task({ id: 'future', date: '2026-11-12' }),
      task({ id: 'done', date: '2026-11-08', done: true }),
      task({ id: 'gone', date: '2026-11-08', deletedAt: 5 }),
    ];
    expect(planRollover(list, '2026-11-10', NOW)).toEqual([]);
  });

  it('只回傳有變動的，且不改動原陣列', () => {
    const list = [task({ id: 'old', date: '2026-11-08' }), task({ id: 'ok', date: '2026-11-10' })];
    const out = planRollover(list, '2026-11-10', NOW);
    expect(out.map((t) => t.id)).toEqual(['old']);
    expect(list[0].date).toBe('2026-11-08');
  });

  it('再跑一次不會重複累加（已經是今天）', () => {
    const once = planRollover([task({ id: 'a', date: '2026-11-09' })], '2026-11-10', NOW);
    expect(planRollover(once, '2026-11-10', NOW)).toEqual([]);
  });
});
