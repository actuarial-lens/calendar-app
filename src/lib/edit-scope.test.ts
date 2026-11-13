import { describe, expect, it } from 'vitest';
import { saveForm } from './actions';
import { BACKUP_FORMAT, parseBackup } from './backup';
import { formFromTask, newForm, type EditorForm } from './editor';
import { applyToTasks, needsEditScope, planRepeats } from './repeat';
import type { Task } from '../types';

let n = 0;
const nid = () => 'id' + ++n;
const NOW = 9000;
const TODAY = '2026-11-13';

const mk = (over: Partial<Task> = {}): Task => ({
  id: 'x' + ++n, date: '2026-11-13', time: '10:00', category: '會議', title: '週會', note: '',
  done: false, delayDays: 0, createdAt: 1, updatedAt: 1, ...over,
});
const rep = (occ: string, extra = {}) => ({ seriesId: 's1', freq: 'weekly' as const, anchor: '2026-11-06', occurrence: occ, ...extra });

/** 一組每週重複（舊資料，沒有 tpl）：11/6 已完成、11/13、11/20、11/27 */
function series(extra = {}) {
  return [
    mk({ id: 'p', date: '2026-11-06', done: true, repeat: rep('2026-11-06', extra) }),
    mk({ id: 'a', date: '2026-11-13', repeat: rep('2026-11-13', extra) }),
    mk({ id: 'b', date: '2026-11-20', repeat: rep('2026-11-20', extra) }),
    mk({ id: 'c', date: '2026-11-27', repeat: rep('2026-11-27', extra) }),
  ];
}
const byId = (ts: Task[]) => new Map(ts.map((t) => [t.id, t]));
const save = (t: Task, patch: Partial<EditorForm>, all: Task[], scope: 'one' | 'future') =>
  saveForm({ ...formFromTask(t), ...patch, editScope: scope }, t, NOW, 'z', all)!;
const after = (all: Task[], put: Task[]) => applyToTasks(all, { putTasks: put, delTaskIds: [], putNotes: [], delNoteIds: [] });
const future = (ts: Task[]) => planRepeats(ts, TODAY, NOW, nid);

describe('needsEditScope：什麼時候要問範圍', () => {
  const [, a] = series();
  it('改標題、時間、分類、提前提醒要問', () => {
    expect(needsEditScope(a, { ...formFromTask(a), title: '新標題' })).toBe(true);
    expect(needsEditScope(a, { ...formFromTask(a), timeVal: '15:00' })).toBe(true);
    expect(needsEditScope(a, { ...formFromTask(a), timeMode: '上午' })).toBe(true);
    expect(needsEditScope(a, { ...formFromTask(a), category: '私人' })).toBe(true);
    expect(needsEditScope(a, { ...formFromTask(a), lead: 10 })).toBe(true);
  });
  it('什麼都沒改、只改日期、只改重要、標題只多了空白：不問', () => {
    expect(needsEditScope(a, formFromTask(a))).toBe(false);
    expect(needsEditScope(a, { ...formFromTask(a), date: '2026-11-14' })).toBe(false);
    expect(needsEditScope(a, { ...formFromTask(a), important: true, importantScope: 'future' })).toBe(false);
    expect(needsEditScope(a, { ...formFromTask(a), title: ' 週會 ' })).toBe(false);
  });
  it('改了重複設定（另開一組）或不是重複事項、新增：不問', () => {
    expect(needsEditScope(a, { ...formFromTask(a), title: 'x', until: '2026-12-31' })).toBe(false);
    expect(needsEditScope(a, { ...formFromTask(a), title: 'x', repeat: 'none' })).toBe(false);
    const plain = mk();
    expect(needsEditScope(plain, { ...formFromTask(plain), title: 'x' })).toBe(false);
    expect(needsEditScope(undefined, { ...newForm(TODAY), title: 'x', repeat: 'weekly' })).toBe(false);
  });
});

describe('僅限這次', () => {
  it('改最後一筆的時間：只改它，之後新排的仍是原本的時間（錯誤 7）', () => {
    const all = series();
    const c = all[3];
    const put = save(c, { timeVal: '15:00' }, all, 'one').changes.putTasks;
    expect(put).toHaveLength(1);
    expect(put[0]).toMatchObject({ id: 'c', time: '15:00' });
    expect(put[0].repeat!.tpl).toEqual({ title: '週會', time: '10:00', category: '會議' });
    const more = future(after(all, put));
    expect(more.length).toBeGreaterThan(0);
    expect(more.every((x) => x.time === '10:00')).toBe(true);
  });

  it('改中間一筆：其他筆、之後新排的都不變', () => {
    const all = series();
    const put = save(all[1], { title: '改名' }, all, 'one').changes.putTasks;
    expect(put.map((t) => t.id)).toEqual(['a']);
    const next = after(all, put);
    expect(byId(next).get('b')!.title).toBe('週會');
    expect(future(next).every((x) => x.title === '週會')).toBe(true);
  });
});

describe('未來每一次', () => {
  it('改時間：這一筆和之後還沒完成的都改，之前的與已完成的不動，之後新排的也跟著', () => {
    const all = [...series(), mk({ id: 'd', date: '2026-12-04', done: true, repeat: rep('2026-12-04') }), mk({ id: 'e', date: '2026-12-11', deletedAt: 5, repeat: rep('2026-12-11') })];
    const a = all[1];
    const res = save(a, { timeVal: '15:00' }, all, 'future');
    const put = byId(res.changes.putTasks);
    expect(res.message).toBe('已更新未來每一次');
    expect(put.get('a')!.time).toBe('15:00');
    expect(put.get('b')!.time).toBe('15:00');
    expect(put.get('c')!.time).toBe('15:00');
    expect(put.get('d')!.time).toBe('10:00'); // 已完成：內容不動
    expect(put.get('e')!.time).toBe('10:00'); // 已刪除：內容不動
    expect(put.has('p')).toBe(false); // 之前的那筆不動
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(put.get(id)!.repeat!.tpl!.time).toBe('15:00');
    const more = future(after(all, res.changes.putTasks));
    expect(more.length).toBeGreaterThan(0);
    expect(more.every((x) => x.time === '15:00' && x.repeat!.tpl!.time === '15:00')).toBe(true);
  });

  it('只套用有改的欄位：之後那筆自己改過的標題留著', () => {
    const all = series();
    all[2] = { ...all[2], title: '週會（外部）' };
    const put = byId(save(all[1], { category: '私人' }, all, 'future').changes.putTasks);
    expect(put.get('b')).toMatchObject({ title: '週會（外部）', category: '私人' });
    expect(put.get('c')).toMatchObject({ title: '週會', category: '私人' });
  });

  it('改日期只改這一筆；時間有改就清掉手動排的順序', () => {
    const all = series();
    all[2] = { ...all[2], order: 3 };
    const put = byId(save(all[1], { date: '2026-11-14', timeVal: '15:00' }, all, 'future').changes.putTasks);
    expect(put.get('a')!.date).toBe('2026-11-14');
    expect(put.get('b')!.date).toBe('2026-11-20');
    expect(put.get('b')!.time).toBe('15:00');
    expect('order' in put.get('b')!).toBe(false);
  });

  it('提前提醒改回跟隨預設：之後的獨立設定也拿掉', () => {
    const all = series().map((t) => ({ ...t, leadMinutes: 10 }));
    const put = byId(save(all[1], { lead: null }, all, 'future').changes.putTasks);
    for (const id of ['a', 'b', 'c']) expect('leadMinutes' in put.get(id)!).toBe(false);
    expect('leadMinutes' in put.get('a')!.repeat!.tpl!).toBe(false);
    const more = future(after(all, [...put.values()]));
    expect(more.every((x) => x.leadMinutes === undefined)).toBe(true);
  });

  it('同時選了「重要：未來每一次」：兩種都套用', () => {
    const all = series();
    const res = saveForm({ ...formFromTask(all[1]), title: '新週會', important: true, importantScope: 'future', editScope: 'future' }, all[1], NOW, 'z', all)!;
    const put = byId(res.changes.putTasks);
    expect(put.get('c')).toMatchObject({ title: '新週會', important: true });
    expect(put.get('c')!.repeat).toMatchObject({ important: true, tpl: { title: '新週會' } });
    const more = future(after(all, res.changes.putTasks));
    expect(more.every((x) => x.title === '新週會' && x.important)).toBe(true);
  });

  it('舊資料（沒有 tpl）：範本以最後一筆為準，只換有改的欄位', () => {
    const all = series();
    all[3] = { ...all[3], category: '私人' }; // 舊版改過最後一筆
    const put = byId(save(all[1], { timeVal: '15:00' }, all, 'future').changes.putTasks);
    expect(put.get('a')!.repeat!.tpl).toEqual({ title: '週會', time: '15:00', category: '私人' });
  });

  it('沒改任何內容卻選了未來每一次：只存這一筆', () => {
    const all = series();
    const put = save(all[1], {}, all, 'future').changes.putTasks;
    expect(put).toHaveLength(1);
  });
});

describe('整組範本的保存', () => {
  it('新增重複事項就存 tpl', () => {
    const t = saveForm({ ...newForm(TODAY), title: '晨跑', timeMode: 'pick', timeVal: '07:00', category: '私人', lead: 15, repeat: 'weekly' }, undefined, NOW, 'n1', [], 's9')!.changes.putTasks[0];
    expect(t.repeat!.tpl).toEqual({ title: '晨跑', time: '07:00', category: '私人', leadMinutes: 15 });
    expect(future([t]).every((x) => x.time === '07:00' && x.leadMinutes === 15)).toBe(true);
  });

  it('改了重複設定另開一組：新的一組用這一筆改好的內容', () => {
    const all = series();
    const put = saveForm({ ...formFromTask(all[1]), title: '新的', until: '2026-12-31' }, all[1], NOW, 'z', all, 's2')!.changes.putTasks;
    expect(put[0].repeat).toMatchObject({ seriesId: 's2', tpl: { title: '新的' } });
  });

  it('匯入：tpl 格式不對的略過，正確的保留', () => {
    const good = mk({ repeat: { ...rep('2026-11-13'), tpl: { title: 'x', time: '10:00', category: '會議' } } });
    const bad = mk({ repeat: { ...rep('2026-11-13'), tpl: { title: 'x', time: '10:00', category: '別的' } as never } });
    const r = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: 1, tasks: [good, bad], notes: [] }));
    expect(r.ok && r.backup.tasks.map((t) => t.id)).toEqual([good.id]);
    expect(r.ok && r.skipped).toBe(1);
  });
});
