import { describe, expect, it } from 'vitest';
import { saveForm } from './actions';
import { BACKUP_FORMAT, parseBackup } from './backup';
import { formFromTask, newForm } from './editor';
import { applyToTasks, planRepeats } from './repeat';
import type { Task } from '../types';

let n = 0;
const nid = () => 'id' + ++n;
const NOW = 9000;
const TODAY = '2026-11-13';

const mk = (over: Partial<Task> = {}): Task => ({
  id: 'x' + ++n, date: '2026-11-13', time: '15:00', category: '待辦', title: '週報', note: '',
  done: false, delayDays: 0, createdAt: 1, updatedAt: 1, ...over,
});
const rep = (occ: string, extra = {}) => ({ seriesId: 's1', freq: 'weekly' as const, anchor: '2026-11-13', occurrence: occ, ...extra });

/** 一組每週重複：11/13、11/20、11/27（11/6 已完成） */
function series(extra = {}) {
  return [
    mk({ id: 'p', date: '2026-11-06', done: true, repeat: rep('2026-11-06', extra) }),
    mk({ id: 'a', date: '2026-11-13', repeat: rep('2026-11-13', extra) }),
    mk({ id: 'b', date: '2026-11-20', repeat: rep('2026-11-20', extra) }),
    mk({ id: 'c', date: '2026-11-27', repeat: rep('2026-11-27', extra) }),
  ];
}
const byId = (ts: Task[]) => new Map(ts.map((t) => [t.id, t]));

describe('重要：新增與一般事項', () => {
  it('新增事項選了重要就存 important: true；沒選就沒有欄位', () => {
    const on = saveForm({ ...newForm(TODAY), title: 'x', important: true }, undefined, NOW, 'n1')!;
    expect(on.changes.putTasks[0].important).toBe(true);
    const off = saveForm({ ...newForm(TODAY), title: 'x' }, undefined, NOW, 'n2')!;
    expect('important' in off.changes.putTasks[0]).toBe(false);
  });

  it('新增重複事項選了重要：整組都重要，之後排出來的也是', () => {
    const a = saveForm({ ...newForm(TODAY), title: 'x', repeat: 'weekly', important: true }, undefined, NOW, 'n1', [], 's9')!;
    const t = a.changes.putTasks[0];
    expect(t.important).toBe(true);
    expect(t.repeat!.important).toBe(true);
    const more = planRepeats([t], TODAY, NOW, nid);
    expect(more.length).toBeGreaterThan(0);
    expect(more.every((x) => x.important === true)).toBe(true);
  });

  it('編輯一般事項：設為重要、取消重要', () => {
    const t = mk();
    const on = saveForm({ ...formFromTask(t), important: true }, t, NOW, 'z')!.changes.putTasks;
    expect(on).toHaveLength(1);
    expect(on[0].important).toBe(true);
    const off = saveForm({ ...formFromTask(on[0]), important: false }, on[0], NOW, 'z')!.changes.putTasks;
    expect('important' in off[0]).toBe(false);
  });

  it('formFromTask 帶入重要、範圍預設僅限這次', () => {
    expect(formFromTask(mk({ important: true }))).toMatchObject({ important: true, importantScope: 'one' });
    expect(formFromTask(mk())).toMatchObject({ important: false, importantScope: 'one' });
  });
});

describe('重要：重複事項', () => {
  it('僅限這次：只改這一筆，其他筆和之後新排的都不受影響（即使這筆是範本）', () => {
    const all = series();
    const c = all[3]; // 最晚的一筆，planRepeats 會拿它當範本
    const put = saveForm({ ...formFromTask(c), important: true, importantScope: 'one' }, c, NOW, 'z', all)!.changes.putTasks;
    expect(put).toHaveLength(1);
    expect(put[0]).toMatchObject({ id: 'c', important: true });
    expect(put[0].repeat!.important).toBeUndefined();
    const after = applyToTasks(all, { putTasks: put, delTaskIds: [], putNotes: [], delNoteIds: [] } as never);
    const more = planRepeats(after, TODAY, NOW, nid);
    expect(more.length).toBeGreaterThan(0);
    expect(more.some((x) => x.important)).toBe(false);
  });

  it('未來每一次：這一筆和之後還沒完成的都改，之前的不動，之後新排的也帶著', () => {
    const all = [...series(), mk({ id: 'd', date: '2026-12-04', done: true, repeat: rep('2026-12-04') })];
    const a = all[1];
    const put = byId(saveForm({ ...formFromTask(a), important: true, importantScope: 'future' }, a, NOW, 'z', all)!.changes.putTasks);
    expect(put.get('a')!.important).toBe(true);
    expect(put.get('b')!.important).toBe(true);
    expect(put.get('c')!.important).toBe(true);
    expect(put.get('d')!.important).toBeUndefined(); // 已完成的不改卡片
    expect(put.get('d')!.repeat!.important).toBe(true); // 但整組設定要跟著（它可能是範本）
    expect(put.has('p')).toBe(false); // 之前的不動
    const after = applyToTasks(all, { putTasks: [...put.values()], delTaskIds: [], putNotes: [], delNoteIds: [] } as never);
    const more = planRepeats(after, TODAY, NOW, nid);
    expect(more.length).toBeGreaterThan(0);
    expect(more.every((x) => x.important === true)).toBe(true);
  });

  it('未來每一次：被刪掉的不會復活，也不改卡片', () => {
    const all = series();
    all[2] = { ...all[2], deletedAt: 1 };
    const put = byId(saveForm({ ...formFromTask(all[1]), important: true, importantScope: 'future' }, all[1], NOW, 'z', all)!.changes.putTasks);
    expect(put.get('b')!.deletedAt).toBe(1);
    expect(put.get('b')!.important).toBeUndefined();
  });

  it('取消重要 — 未來每一次：整組原本重要，這筆和之後的都取消，之後新排的也不重要', () => {
    const all = series({ important: true }).map((t) => ({ ...t, important: true }));
    const put = byId(saveForm({ ...formFromTask(all[1]), important: false, importantScope: 'future' }, all[1], NOW, 'z', all)!.changes.putTasks);
    for (const id of ['a', 'b', 'c']) {
      expect('important' in put.get(id)!).toBe(false);
      expect(put.get(id)!.repeat!.important).toBeUndefined();
    }
    const after = applyToTasks(all, { putTasks: [...put.values()], delTaskIds: [], putNotes: [], delNoteIds: [] } as never);
    expect(planRepeats(after, TODAY, NOW, nid).some((x) => x.important)).toBe(false);
  });

  it('取消重要 — 僅限這次：只有這筆取消，其他和之後新排的仍重要', () => {
    const all = series({ important: true }).map((t) => ({ ...t, important: true }));
    const c = all[3];
    const put = saveForm({ ...formFromTask(c), important: false, importantScope: 'one' }, c, NOW, 'z', all)!.changes.putTasks;
    expect(put).toHaveLength(1);
    expect('important' in put[0]).toBe(false);
    expect(put[0].repeat!.important).toBe(true);
    const after = applyToTasks(all, { putTasks: put, delTaskIds: [], putNotes: [], delNoteIds: [] } as never);
    const more = planRepeats(after, TODAY, NOW, nid);
    expect(more.length).toBeGreaterThan(0);
    expect(more.every((x) => x.important === true)).toBe(true);
  });

  it('沒動「重要」（詢問框按取消）：存檔不會改到其他筆，也不會改整組設定', () => {
    const all = series();
    const put = saveForm({ ...formFromTask(all[1]), title: '新標題' }, all[1], NOW, 'z', all)!.changes.putTasks;
    expect(put).toHaveLength(1);
    expect(put[0].important).toBeUndefined();
    expect(put[0].repeat!.important).toBeUndefined();
  });

  it('同時改了重複設定：新開的一組依範圍決定要不要重要', () => {
    const all = series();
    const one = saveForm({ ...formFromTask(all[1]), repeat: 'monthly', important: true, importantScope: 'one' }, all[1], NOW, 'z', all, 's2')!.changes.putTasks;
    expect(one[0]).toMatchObject({ important: true });
    expect(one[0].repeat).toMatchObject({ seriesId: 's2' });
    expect(one[0].repeat!.important).toBeUndefined();
    const fut = saveForm({ ...formFromTask(all[1]), repeat: 'monthly', important: true, importantScope: 'future' }, all[1], NOW, 'z', all, 's3')!.changes.putTasks;
    expect(fut[0].repeat).toMatchObject({ seriesId: 's3', important: true });
  });
});

describe('重要：備份', () => {
  const file = (t: object) => JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: 1, tasks: [t], notes: [] });
  it('匯入帶著 important；沒有這個欄位也可以；格式錯的略過', () => {
    const ok = parseBackup(file(mk({ important: true, repeat: rep('2026-11-13', { important: true }) })));
    expect(ok.ok && ok.backup.tasks[0].important).toBe(true);
    expect(ok.ok && ok.backup.tasks[0].repeat!.important).toBe(true);
    const none = parseBackup(file(mk()));
    expect(none.ok && none.backup.tasks.length).toBe(1);
    const bad = parseBackup(file({ ...mk(), important: 'yes' }));
    expect(bad.ok && bad.skipped).toBe(1);
  });
});
