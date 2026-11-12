import { describe, expect, it } from 'vitest';
import { buildBackup, importSummary, parseBackup, planImport } from './backup';
import type { Note, Task } from '../types';

const task = (o: Partial<Task> = {}): Task => ({
  id: 't1', date: '2026-11-12', time: '', category: '待辦', title: 'a', note: '', done: false,
  delayDays: 0, createdAt: 1, updatedAt: 1, ...o,
});
const note = (o: Partial<Note> = {}): Note => ({ id: 'n1', date: '2026-11-12', text: 'x', createdAt: 1, updatedAt: 1, ...o });

describe('匯出', () => {
  it('不帶已刪除的；格式標記正確；沒有任何設定欄位', () => {
    const b = buildBackup([task(), task({ id: 't2', deletedAt: 5 })], [note(), note({ id: 'n2', deletedAt: 5 })], 99);
    expect(b.tasks.map((t) => t.id)).toEqual(['t1']);
    expect(b.notes.map((n) => n.id)).toEqual(['n1']);
    expect(Object.keys(b).sort()).toEqual(['exportedAt', 'format', 'notes', 'tasks', 'version']);
  });
  it('匯出再讀入：內容一致', () => {
    const t = [task({ repeat: { seriesId: 's', freq: 'weekly', anchor: '2026-11-12', occurrence: '2026-11-12' } })];
    const r = parseBackup(JSON.stringify(buildBackup(t, [note()], 1)));
    expect(r.ok && r.backup.tasks).toEqual(t);
  });
});

describe('讀入檢查', () => {
  it('不是 JSON / 不是備份檔 / 版本太新 → 錯誤', () => {
    expect(parseBackup('hello')).toMatchObject({ ok: false });
    expect(parseBackup('{"a":1}')).toMatchObject({ ok: false });
    expect(parseBackup(JSON.stringify({ format: 'calendar-backup', version: 99, tasks: [], notes: [] }))).toMatchObject({ ok: false });
  });
  it('壞掉的單筆略過並計數，其餘照收', () => {
    const r = parseBackup(JSON.stringify({ format: 'calendar-backup', version: 1, exportedAt: 1, tasks: [task(), { id: 'bad' }, task({ id: 'x', date: '昨天' })], notes: [note(), 5] }));
    expect(r.ok && r.skipped).toBe(3);
    expect(r.ok && r.backup.tasks).toHaveLength(1);
    expect(r.ok && r.backup.notes).toHaveLength(1);
  });
});

describe('合併', () => {
  const backup = (tasks: Task[], notes: Note[] = []) => ({ format: 'calendar-backup' as const, version: 1, exportedAt: 1, tasks, notes });
  it('新的加入；相同 id 以較新的為準；較舊的不覆蓋；絕不刪除', () => {
    const cur = [task({ id: 'a', updatedAt: 10, title: '本機' }), task({ id: 'b', updatedAt: 10, title: '本機b' }), task({ id: 'keep' })];
    const inc = [task({ id: 'a', updatedAt: 20, title: '備份較新' }), task({ id: 'b', updatedAt: 5, title: '備份較舊' }), task({ id: 'c' })];
    const p = planImport(backup(inc), cur, []);
    expect(p.changes.putTasks.map((t) => t.id).sort()).toEqual(['a', 'c']);
    expect(p.changes.putTasks.find((t) => t.id === 'a')?.title).toBe('備份較新');
    expect(p.changes.delTaskIds).toEqual([]);
    expect([p.addedTasks, p.updatedTasks]).toEqual([1, 1]);
  });
  it('備忘同理；重複匯入第二次沒有任何變動', () => {
    const b = backup([task()], [note()]);
    const first = planImport(b, [], []);
    expect([first.addedTasks, first.addedNotes]).toEqual([1, 1]);
    const second = planImport(b, first.changes.putTasks, first.changes.putNotes);
    expect(second.changes.putTasks).toEqual([]);
    expect(second.changes.putNotes).toEqual([]);
    expect(importSummary(second, 0)).toBe('沒有需要匯入的新資料。');
  });
  it('摘要文字', () => {
    expect(importSummary(planImport(backup([task()], [note()]), [], []), 2)).toBe('已匯入：新增事項 1、更新 0；新增備忘 1、更新 0；略過格式不符 2 筆。');
  });
});
