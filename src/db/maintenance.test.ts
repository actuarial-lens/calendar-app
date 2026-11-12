import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppDB } from './db';
import { PURGE_AFTER_MS, addNote, buildSampleData, isExpired, purgeExpired, seedIfFirstRun } from './maintenance';

const DAY = 24 * 60 * 60 * 1000;
let db: AppDB;
let n = 0;
beforeEach(async () => {
  db = new AppDB('test-' + n++);
  await db.open();
});

describe('軟刪除清理', () => {
  it('超過 14 天才算過期', () => {
    const now = 1_000_000_000_000;
    expect(isExpired(undefined, now)).toBe(false);
    expect(isExpired(now - PURGE_AFTER_MS, now)).toBe(false);
    expect(isExpired(now - PURGE_AFTER_MS - 1, now)).toBe(true);
  });

  it('啟動時只清掉過期的，其餘保留', async () => {
    const now = Date.now();
    const base = { date: '2026-11-10', time: '' as const, category: '待辦' as const, note: '', done: false, delayDays: 0, createdAt: 1, updatedAt: 1 };
    await db.tasks.bulkAdd([
      { ...base, id: 'old', title: 'old', deletedAt: now - 15 * DAY },
      { ...base, id: 'recent', title: 'recent', deletedAt: now - 13 * DAY },
      { ...base, id: 'live', title: 'live' },
    ]);
    await db.notes.bulkAdd([
      { id: 'n-old', date: '2026-11-10', text: 'x', createdAt: 1, updatedAt: 1, deletedAt: now - 20 * DAY },
      { id: 'n-live', date: '2026-11-10', text: 'y', createdAt: 1, updatedAt: 1 },
    ]);
    await purgeExpired(db, now);
    expect((await db.tasks.toArray()).map((t) => t.id).sort()).toEqual(['live', 'recent']);
    expect((await db.notes.toArray()).map((x) => x.id)).toEqual(['n-live']);
  });
});

describe('範例資料與隨手記', () => {
  it('只在第一次開啟時放範例資料', async () => {
    expect(await seedIfFirstRun(db, '2026-11-10')).toBe(true);
    const count = await db.tasks.count();
    expect(count).toBe(9);
    expect(await seedIfFirstRun(db, '2026-11-10')).toBe(false);
    expect(await db.tasks.count()).toBe(count);
  });

  it('範例資料日期相對於今天，且有一筆「延 1 天」', () => {
    const { tasks, notes } = buildSampleData('2026-11-10', Date.now());
    expect(tasks.filter((t) => t.date === '2026-11-10').length).toBe(5);
    expect(tasks.filter((t) => t.delayDays > 0).length).toBe(1);
    expect(notes.every((x) => x.date === '2026-11-10')).toBe(true);
  });

  it('新增隨手記會存進資料庫並記下時間', async () => {
    await addNote(db, '2026-11-12', '買電池', 12345);
    const rows = await db.notes.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: '2026-11-12', text: '買電池', createdAt: 12345 });
  });
});

describe('重複事項與資料庫', () => {
  it('ensureRepeats 補排一次後再跑不會重複；被刪掉的未來那筆在日期過去前不會被清掉', async () => {
    const { ensureRepeats } = await import('./maintenance');
    const db = new AppDB('repeat-test-' + Math.random());
    const now = new Date(2026, 10, 10, 9).getTime();
    const base = { time: '15:00' as const, category: '待辦' as const, title: '週報', note: '', done: false, delayDays: 0, createdAt: 1, updatedAt: 1 };
    await db.tasks.bulkAdd([
      { ...base, id: 'a', date: '2026-11-13', repeat: { seriesId: 's', freq: 'weekly', anchor: '2026-11-13', occurrence: '2026-11-13' } },
      { ...base, id: 'b', date: '2026-11-20', deletedAt: now - 30 * 86400000, repeat: { seriesId: 's', freq: 'weekly', anchor: '2026-11-13', occurrence: '2026-11-20' } },
    ]);
    const n1 = await ensureRepeats(db, '2026-11-10', now);
    expect(n1).toBeGreaterThan(0);
    expect(await ensureRepeats(db, '2026-11-10', now)).toBe(0);
    await purgeExpired(db, now, '2026-11-10');
    expect(await db.tasks.get('b')).toBeTruthy(); // 刪除超過 14 天，但日期還沒到，不能清
    await purgeExpired(db, now, '2026-11-25');
    expect(await db.tasks.get('b')).toBeUndefined();
  });
});

describe('清掉範例資料', () => {
  it('只清掉內容完全相符的範例，使用者自己的不動，而且只做一次', async () => {
    const { removeSampleData } = await import('./maintenance');
    const db = new AppDB('sample-test-' + Math.random());
    const now = Date.now();
    await seedIfFirstRun(db, '2026-11-10', now);
    await addNote(db, '2026-11-10', '我自己的筆記', now);
    await db.tasks.add({ id: 'mine', date: '2026-11-10', time: '', category: '待辦', title: '廠商報價', note: '我自己改過的備註', done: false, delayDays: 0, createdAt: now, updatedAt: now });
    await db.tasks.add({ id: 'mine2', date: '2026-11-10', time: '', category: '待辦', title: '買牛奶', note: '', done: true, doneAt: now, delayDays: 0, createdAt: now, updatedAt: now });
    expect(await removeSampleData(db)).toBe(11);
    const left = await db.tasks.toArray();
    expect(left.map((t) => t.id).sort()).toEqual(['mine', 'mine2']);
    expect((await db.notes.toArray()).map((n) => n.text)).toEqual(['我自己的筆記']);
    // 第二次不會再動任何東西
    await db.tasks.add({ id: 'again', date: '2026-11-10', time: '', category: '會議', title: '晨會', note: '準備上週進度三點', done: false, delayDays: 0, createdAt: now, updatedAt: now });
    expect(await removeSampleData(db)).toBe(0);
    expect(await db.tasks.get('again')).toBeTruthy();
  });
});
