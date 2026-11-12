import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings, type Task } from '../types';
import { LIVE_WINDOW_MS, MINUTE, atLocal, buildReminders, leadReminderAt, splitDue } from './reminders';

const at = (d: string, hm: string) => atLocal(d, hm)!;
const S = (p: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...p });
const task = (p: Partial<Task> & { id: string }): Task => ({
  date: '2026-11-10', time: '14:00', category: '會議', title: p.id, note: '',
  done: false, delayDays: 0, createdAt: 1, updatedAt: 1, ...p,
});
const D0 = at('2026-11-10', '00:00');
const D1 = at('2026-11-11', '00:00');

describe('提醒時間計算', () => {
  it('atLocal 解析 HH:mm，格式不對回傳 null', () => {
    expect(atLocal('2026-11-10', '14:00')).toBe(new Date(2026, 10, 10, 14, 0).getTime());
    expect(atLocal('2026-11-10', '9:05')).toBe(new Date(2026, 10, 10, 9, 5).getTime());
    expect(atLocal('2026-11-10', '上午')).toBeNull();
    expect(atLocal('2026-11-10', '')).toBeNull();
    expect(atLocal('2026-11-10', '25:00')).toBeNull();
  });

  it('指定時間：時間 − 提前分鐘', () => {
    expect(leadReminderAt({ date: '2026-11-10', time: '14:00' }, 10)).toBe(at('2026-11-10', '13:50'));
    expect(leadReminderAt({ date: '2026-11-10', time: '14:00' }, 30)).toBe(at('2026-11-10', '13:30'));
  });

  it('跨過午夜：00:05 的事項、提前 10 分鐘 → 前一天 23:55', () => {
    expect(leadReminderAt({ date: '2026-11-11', time: '00:05' }, 10)).toBe(at('2026-11-10', '23:55'));
  });

  it('上午／下午／不設時間沒有提前提醒', () => {
    expect(leadReminderAt({ date: '2026-11-10', time: '上午' }, 10)).toBeNull();
    expect(leadReminderAt({ date: '2026-11-10', time: '下午' }, 10)).toBeNull();
    expect(leadReminderAt({ date: '2026-11-10', time: '' }, 10)).toBeNull();
  });
});

describe('每件事自己的提前提醒', () => {
  const day = at('2026-11-10', '00:00');
  const lead = (t: Task, st = S()) => buildReminders([t], st, day, day + 86_400_000).find((r) => r.kind === 'lead');
  it('預設 30 分鐘；沒有自己設定的事項照預設', () => {
    expect(DEFAULT_SETTINGS.leadMinutes).toBe(30);
    expect(lead(task({ id: 'a', time: '14:00' }))!.at).toBe(at('2026-11-10', '13:30'));
  });
  it('事項自己設定時優先；改預設不影響它，會影響沒設定的', () => {
    const own = task({ id: 'a', time: '14:00', leadMinutes: 10 });
    expect(lead(own)!.at).toBe(at('2026-11-10', '13:50'));
    expect(lead(own, S({ leadMinutes: 5 }))!.at).toBe(at('2026-11-10', '13:50'));
    expect(lead(task({ id: 'b', time: '14:00' }), S({ leadMinutes: 5 }))!.at).toBe(at('2026-11-10', '13:55'));
  });
  it('分鐘數不同，提醒 id 也不同（改了就會重新提醒）', () => {
    expect(lead(task({ id: 'a', time: '14:00', leadMinutes: 10 }))!.id).not.toBe(lead(task({ id: 'a', time: '14:00' }))!.id);
  });
});

describe('早上提醒開關', () => {
  const t = [task({ id: 'a', date: '2026-11-10', time: '14:00' })];
  const kinds = (st: Settings) => buildReminders(t, st, D0, D1).map((r) => r.kind);
  it('預設是開的；關掉後沒有早上提醒，提前提醒不受影響', () => {
    expect(DEFAULT_SETTINGS.morningEnabled).toBe(true);
    expect(kinds(S())).toEqual(['morning', 'lead']);
    expect(kinds(S({ morningEnabled: false }))).toEqual(['lead']);
  });
});

describe('buildReminders', () => {
  const s = S({ morningTime: '08:30', leadMinutes: 10 });

  it('指定時間的未完成事項 → 一個提前提醒，內容是標題和時間', () => {
    const list = buildReminders([task({ id: 'a', title: '對稿', time: '14:00' })], s, D0, D1);
    const lead = list.filter((r) => r.kind === 'lead');
    expect(lead).toHaveLength(1);
    expect(lead[0]).toMatchObject({ at: at('2026-11-10', '13:50'), title: '對稿', body: '11/10（二） 14:00', date: '2026-11-10', taskId: 'a' });
  });

  it('已完成、已刪除、沒有指定時間的不提醒', () => {
    const list = buildReminders(
      [task({ id: 'done', done: true }), task({ id: 'gone', deletedAt: 1 }), task({ id: 'am', time: '上午' }), task({ id: 'none', time: '' })],
      s, D0, D1,
    );
    expect(list.filter((r) => r.kind === 'lead')).toEqual([]);
  });

  it('只回傳 (from, to] 之間的提醒', () => {
    const t = [task({ id: 'a', time: '14:00' })];
    const when = at('2026-11-10', '13:50');
    expect(buildReminders(t, s, when - 1, when).filter((r) => r.kind === 'lead')).toHaveLength(1); // 剛好等於 to → 含
    expect(buildReminders(t, s, when, when + MINUTE).filter((r) => r.kind === 'lead')).toHaveLength(0); // 剛好等於 from → 不含
  });

  it('早上提醒：今天還有 N 件事，列出前三件（含上午、下午、不設時間），依排序', () => {
    const t = [
      task({ id: 'd', title: '下午事', time: '下午' }),
      task({ id: 'a', title: '無時間', time: '' }),
      task({ id: 'b', title: '十點', time: '10:00' }),
      task({ id: 'c', title: '上午事', time: '上午' }),
      task({ id: 'x', title: '做完了', done: true }),
    ];
    const m = buildReminders(t, s, D0, D1).find((r) => r.kind === 'morning')!;
    expect(m).toMatchObject({ at: at('2026-11-10', '08:30'), title: '今天還有 4 件事', date: '2026-11-10' });
    expect(m.body).toBe('無時間、十點、上午事…');
  });

  it('早上提醒：剛好三件不加刪節號；那天沒有未完成事項就不提醒', () => {
    const three = [task({ id: 'a', title: 'A', time: '' }), task({ id: 'b', title: 'B', time: '' }), task({ id: 'c', title: 'C', time: '' })];
    expect(buildReminders(three, s, D0, D1).find((r) => r.kind === 'morning')!.body).toBe('A、B、C');
    expect(buildReminders([task({ id: 'x', done: true })], s, D0, D1).filter((r) => r.kind === 'morning')).toEqual([]);
    expect(buildReminders([], s, D0, D1)).toEqual([]);
  });

  it('跨多天：每天各一個早上提醒', () => {
    const t = [task({ id: 'a', date: '2026-11-10', time: '' }), task({ id: 'b', date: '2026-11-12', time: '' })];
    const ms = buildReminders(t, s, D0, at('2026-11-13', '00:00')).filter((r) => r.kind === 'morning');
    expect(ms.map((r) => r.date)).toEqual(['2026-11-10', '2026-11-12']);
  });

  it('依時間先後排序', () => {
    const list = buildReminders([task({ id: 'a', time: '09:00' })], s, D0, D1);
    expect(list.map((r) => r.kind)).toEqual(['morning', 'lead']); // 08:30 早上提醒 → 08:50 提前提醒
    expect(list.map((r) => r.at)).toEqual([...list.map((r) => r.at)].sort((x, y) => x - y));
  });

  it('改時間／延後／提前分鐘／早上時間，提醒 id 都會變（才會重新提醒）；完成、刪除則提醒消失', () => {
    const base = task({ id: 'a', time: '14:00' });
    const idOf = (t: Task, st = s) => buildReminders([t], st, D0, at('2026-11-12', '00:00')).find((r) => r.kind === 'lead')?.id;
    const original = idOf(base);
    expect(idOf({ ...base, time: '15:00' })).not.toBe(original);
    expect(idOf({ ...base, date: '2026-11-11' })).not.toBe(original);
    expect(idOf(base, S({ leadMinutes: 30 }))).not.toBe(original);
    expect(idOf(base)).toBe(original); // 沒改就一樣
    expect(idOf({ ...base, done: true })).toBeUndefined();
    expect(idOf({ ...base, deletedAt: 5 })).toBeUndefined();
    const m1 = buildReminders([base], s, D0, D1).find((r) => r.kind === 'morning')!.id;
    const m2 = buildReminders([base], S({ morningTime: '09:00' }), D0, D1).find((r) => r.kind === 'morning')!.id;
    expect(m1).not.toBe(m2);
  });

  it('早上時間格式壞掉時退回預設 08:30', () => {
    const m = buildReminders([task({ id: 'a', time: '' })], S({ morningTime: 'abc' }), D0, D1).find((r) => r.kind === 'morning')!;
    expect(m.at).toBe(at('2026-11-10', '08:30'));
  });
});

describe('splitDue（剛剛到的 vs 錯過的）', () => {
  const now = at('2026-11-10', '12:00');
  const r = (id: string, ago: number) => ({ id, kind: 'lead' as const, at: now - ago, date: '2026-11-10', title: id, body: '' });
  it('2 分鐘內 = live，更早 = missed', () => {
    const { live, missed } = splitDue([r('a', 10_000), r('b', LIVE_WINDOW_MS), r('c', LIVE_WINDOW_MS + 1), r('d', 3600_000)], now);
    expect(live.map((x) => x.id)).toEqual(['a', 'b']);
    expect(missed.map((x) => x.id)).toEqual(['c', 'd']);
  });
});
