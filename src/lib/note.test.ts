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
/** 舊資料（範本沒有 note）：11/13、11/20、11/27 */
function series(note = '') {
  return ['2026-11-13', '2026-11-20', '2026-11-27'].map((d, i) =>
    mk({ id: 'abc'[i], date: d, note, repeat: rep(d, { tpl: { title: '週會', time: '10:00' as const, category: '會議' as const } }) }),
  );
}
const byId = (ts: Task[]) => new Map(ts.map((t) => [t.id, t]));
const save = (t: Task, patch: Partial<EditorForm>, all: Task[], scope: 'one' | 'future') =>
  saveForm({ ...formFromTask(t), ...patch, editScope: scope }, t, NOW, 'z', all)!;
const after = (all: Task[], put: Task[]) => applyToTasks(all, { putTasks: put, delTaskIds: [], putNotes: [], delNoteIds: [] });
const future = (ts: Task[]) => planRepeats(ts, TODAY, NOW, nid);

describe('備註：新增與編輯', () => {
  it('新增：備註去掉頭尾空白，保留中間的換行', () => {
    const a = saveForm({ ...newForm(TODAY), title: '開會', note: '  三樓會議室\n帶筆電  \n' }, undefined, NOW, 'n1')!;
    expect(a.changes.putTasks[0].note).toBe('三樓會議室\n帶筆電');
  });
  it('新增：不填備註就是空字串', () => {
    expect(saveForm({ ...newForm(TODAY), title: '開會' }, undefined, NOW, 'n1')!.changes.putTasks[0].note).toBe('');
  });
  it('編輯一般事項：帶入原本的備註，改了就寫入，清空也可以', () => {
    const t = mk({ note: '舊備註' });
    expect(formFromTask(t).note).toBe('舊備註');
    expect(saveForm({ ...formFromTask(t), note: '新備註\n第二行' }, t, NOW, 'z')!.changes.putTasks[0].note).toBe('新備註\n第二行');
    expect(saveForm({ ...formFromTask(t), note: '   ' }, t, NOW, 'z')!.changes.putTasks[0].note).toBe('');
  });
  it('編輯時沒動備註：不變', () => {
    const t = mk({ note: '地點' });
    expect(saveForm(formFromTask(t), t, NOW, 'z')!.changes.putTasks[0].note).toBe('地點');
  });
  it('新增重複事項：範本帶備註，新排的都有', () => {
    const t = saveForm({ ...newForm(TODAY), title: '晨跑', note: '帶水', repeat: 'weekly' }, undefined, NOW, 'n1', [], 's9')!.changes.putTasks[0];
    expect(t.repeat!.tpl!.note).toBe('帶水');
    const more = future([t]);
    expect(more.length).toBeGreaterThan(0);
    expect(more.every((x) => x.note === '帶水')).toBe(true);
  });
});

describe('備註：重複事項問範圍', () => {
  it('只改備註也要問；備註只多了空白不問', () => {
    const [a] = series('舊');
    expect(needsEditScope(a, { ...formFromTask(a), note: '新' })).toBe(true);
    expect(needsEditScope(a, { ...formFromTask(a), note: ' 舊 ' })).toBe(false);
    expect(needsEditScope(a, formFromTask(a))).toBe(false);
  });
  it('僅限這次：只改這一筆的備註，範本與之後新排的不變', () => {
    const all = series('原本');
    const put = save(all[2], { note: '只有這次' }, all, 'one').changes.putTasks;
    expect(put).toHaveLength(1);
    expect(put[0].note).toBe('只有這次');
    const more = future(after(all, put));
    expect(more.length).toBeGreaterThan(0);
    expect(more.every((x) => x.note === '原本')).toBe(true);
  });
  it('僅限這次（範本已經有 note）：新排的用範本的備註，不是最後一筆自己的', () => {
    const all = series('原本').map((t) => ({ ...t, repeat: { ...t.repeat!, tpl: { ...t.repeat!.tpl!, note: '原本' } } }));
    const put = save(all[2], { note: '只有這次' }, all, 'one').changes.putTasks;
    expect(future(after(all, put)).every((x) => x.note === '原本')).toBe(true);
  });
  it('未來每一次：這一筆和之後還沒完成的都改，已完成的不動；新排的跟著新備註', () => {
    const all = series('原本');
    all[2] = { ...all[2], done: true };
    const put = byId(save(all[0], { note: '新備註' }, all, 'future').changes.putTasks);
    expect(put.get('a')!.note).toBe('新備註');
    expect(put.get('b')!.note).toBe('新備註');
    expect(put.get('c')!.note).toBe('原本'); // 已完成
    for (const id of ['a', 'b', 'c']) expect(put.get(id)!.repeat!.tpl!.note).toBe('新備註');
    expect(future(after(all, [...put.values()])).every((x) => x.note === '新備註')).toBe(true);
  });
  it('未來每一次：把備註清空，新排的也是空的（不會退回最後一筆的舊備註）', () => {
    const all = series('原本');
    const put = save(all[0], { note: '' }, all, 'future').changes.putTasks;
    expect(future(after(all, put)).every((x) => x.note === '')).toBe(true);
  });
  it('舊資料（範本沒有 note）：新排的沿用最後一筆的備註', () => {
    const all = series('最後一筆的備註');
    const more = future(all);
    expect(more.length).toBeGreaterThan(0);
    expect(more.every((x) => x.note === '最後一筆的備註')).toBe(true);
  });
  it('同時改標題與備註選未來每一次：兩個欄位一起套用', () => {
    const all = series('原本');
    const put = byId(save(all[0], { title: '新週會', note: '新備註' }, all, 'future').changes.putTasks);
    expect(put.get('b')).toMatchObject({ title: '新週會', note: '新備註' });
    expect(put.get('b')!.repeat!.tpl).toMatchObject({ title: '新週會', note: '新備註' });
  });
});

describe('備註：匯入檢查', () => {
  const wrap = (t: unknown) => JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: 1, tasks: [t], notes: [] });
  it('範本的 note 是 undefined 或字串都接受，其他型別略過', () => {
    const base = mk({ repeat: rep('2026-11-13', { tpl: { title: 'x', time: '10:00', category: '會議' } }) });
    const withNote = { ...base, repeat: { ...base.repeat!, tpl: { ...base.repeat!.tpl!, note: '備註' } } };
    const bad = { ...base, repeat: { ...base.repeat!, tpl: { ...base.repeat!.tpl!, note: 5 } } };
    for (const [t, ok] of [[base, 1], [withNote, 1], [bad, 0]] as const) {
      const r = parseBackup(wrap(t));
      expect(r.ok && r.backup.tasks.length).toBe(ok);
    }
  });
});
