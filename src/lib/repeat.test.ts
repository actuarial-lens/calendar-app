import { describe, expect, it } from 'vitest';
import { saveForm } from './actions';
import { newForm } from './editor';
import { applyToTasks, deleteSeries, occurrenceDates, planRepeats, repeatHint, withRepeats } from './repeat';
import type { Task } from '../types';

let n = 0;
const nid = () => 'id' + ++n;

const mk = (over: Partial<Task> = {}): Task => ({
  id: 'x' + ++n,
  date: '2026-11-13',
  time: '15:00',
  category: '待辦',
  title: '週報',
  note: '',
  done: false,
  delayDays: 0,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});
const rep = (occ: string, extra = {}) => ({ seriesId: 's1', freq: 'weekly' as const, anchor: '2026-11-13', occurrence: occ, ...extra });

describe('occurrenceDates', () => {
  it('每週：每 7 天一次，只給 after 之後', () => {
    expect(occurrenceDates('2026-11-13', 'weekly', '2026-11-13', '2026-12-05')).toEqual(['2026-11-20', '2026-11-27', '2026-12-04']);
  });
  it('每週：after 在很久以後也能直接算對', () => {
    expect(occurrenceDates('2026-01-02', 'weekly', '2026-11-09', '2026-11-20')).toEqual(['2026-11-13', '2026-11-20']);
  });
  it('每月：同一個幾號', () => {
    expect(occurrenceDates('2026-11-13', 'monthly', '2026-11-13', '2027-02-28')).toEqual(['2026-12-13', '2027-01-13', '2027-02-13']);
  });
  it('每月：31 號遇到短的月份用月底，隔月回到 31 號', () => {
    expect(occurrenceDates('2026-01-31', 'monthly', '2026-01-31', '2026-05-31')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
    expect(occurrenceDates('2027-12-31', 'monthly', '2027-12-31', '2028-03-31')).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });
  it('結束日期含當天，超過不排', () => {
    expect(occurrenceDates('2026-11-13', 'weekly', '2026-11-13', '2026-12-31', '2026-11-27')).toEqual(['2026-11-20', '2026-11-27']);
  });
});

describe('planRepeats', () => {
  it('從範本往後排到 60 天，只排今天以後', () => {
    const added = planRepeats([mk({ repeat: rep('2026-11-13') })], '2026-11-10', 5, nid);
    expect(added.map((t) => t.date)).toEqual(['2026-11-20', '2026-11-27', '2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25', '2027-01-01', '2027-01-08']);
    expect(added[0]).toMatchObject({ title: '週報', time: '15:00', done: false, delayDays: 0 });
    expect(added[0].repeat).toMatchObject({ seriesId: 's1', occurrence: '2026-11-20' });
  });
  it('再算一次不會重複排', () => {
    const first = mk({ repeat: rep('2026-11-13') });
    const added = planRepeats([first], '2026-11-10', 5, nid);
    expect(planRepeats([first, ...added], '2026-11-10', 6, nid)).toEqual([]);
  });
  it('被刪掉的那一筆也算已排過，不會又排回來', () => {
    const a = mk({ repeat: rep('2026-11-13') });
    const b = mk({ date: '2026-11-20', deletedAt: 9, repeat: rep('2026-11-20') });
    const added = planRepeats([a, b], '2026-11-10', 5, nid);
    expect(added.map((t) => t.date)).not.toContain('2026-11-20');
    expect(added[0].date).toBe('2026-11-27');
  });
  it('被延後的那一筆以原定日期為準，不會多排', () => {
    const a = mk({ date: '2026-11-18', delayDays: 5, repeat: rep('2026-11-13') });
    expect(planRepeats([a], '2026-11-18', 5, nid)[0].date).toBe('2026-11-20');
  });
  it('很久沒開：不補排過去的，從今天以後開始', () => {
    const added = planRepeats([mk({ repeat: rep('2026-01-02', { anchor: '2026-01-02' }) })], '2026-11-10', 5, nid);
    expect(added[0].date).toBe('2026-11-13');
  });
  it('結束日期已過就不排', () => {
    expect(planRepeats([mk({ repeat: rep('2026-11-13', { until: '2026-11-20' }) })], '2026-11-10', 5, nid).map((t) => t.date)).toEqual(['2026-11-20']);
  });
  it('每月重複只排到 60 天內', () => {
    const t = mk({ repeat: { seriesId: 's2', freq: 'monthly', anchor: '2026-11-13', occurrence: '2026-11-13' } });
    expect(planRepeats([t], '2026-11-10', 5, nid).map((x) => x.date)).toEqual(['2026-12-13', '2027-01-09'].slice(0, 1));
  });
});

describe('儲存表單', () => {
  const form = (over = {}) => ({ ...newForm('2026-11-13'), title: '週報', ...over });
  it('新增每週重複：第一筆帶 repeat，補排的一起存、復原時一起拿掉', () => {
    const a = saveForm(form({ repeat: 'weekly' }), undefined, 1, 'T1', [], 'S1')!;
    expect(a.changes.putTasks[0].repeat).toMatchObject({ seriesId: 'S1', freq: 'weekly', anchor: '2026-11-13', occurrence: '2026-11-13' });
    const all = withRepeats(a, [], '2026-11-10', 2, nid);
    expect(all.changes.putTasks.length).toBe(9);
  });
  it('結束日期早於日期就當作不結束', () => {
    const a = saveForm(form({ repeat: 'weekly', until: '2026-11-01' }), undefined, 1, 'T1', [], 'S1')!;
    expect(a.changes.putTasks[0].repeat?.until).toBeUndefined();
  });
  it('只改標題：不動重複設定', () => {
    const t = mk({ id: 'A', repeat: rep('2026-11-13') });
    const a = saveForm({ ...form({ repeat: 'weekly' }), mode: 'edit', id: 'A', title: '週報(新)' }, t, 3, 'u', [t], 'S9')!;
    expect(a.changes.putTasks).toHaveLength(1);
    expect(a.changes.putTasks[0].repeat?.seriesId).toBe('s1');
  });
  it('改成不重複：這一筆脫離，之後還沒做的拿掉，整組記上結束日期', () => {
    const t = mk({ id: 'A', repeat: rep('2026-11-13') });
    const f = mk({ id: 'B', date: '2026-11-20', repeat: rep('2026-11-20') });
    const d = mk({ id: 'C', date: '2026-11-06', done: true, repeat: rep('2026-11-06') });
    const a = saveForm({ ...form({ repeat: 'none' }), mode: 'edit', id: 'A' }, t, 3, 'u', [t, f, d], 'S9')!;
    const byId = Object.fromEntries(a.changes.putTasks.map((x) => [x.id, x]));
    expect(byId.A.repeat).toBeUndefined();
    expect(byId.B.deletedAt).toBe(3);
    expect(byId.C.deletedAt).toBeUndefined();
    expect(byId.B.repeat?.until).toBe('2026-11-12');
    expect(byId.C.repeat?.until).toBe('2026-11-12');
  });
  it('改成每月：另開新的一組，舊的未來筆拿掉', () => {
    const t = mk({ id: 'A', repeat: rep('2026-11-13') });
    const f = mk({ id: 'B', date: '2026-11-20', repeat: rep('2026-11-20') });
    const a = saveForm({ ...form({ repeat: 'monthly' }), mode: 'edit', id: 'A' }, t, 3, 'u', [t, f], 'S9')!;
    const byId = Object.fromEntries(a.changes.putTasks.map((x) => [x.id, x]));
    expect(byId.A.repeat).toMatchObject({ seriesId: 'S9', freq: 'monthly', anchor: '2026-11-13' });
    expect(byId.B.deletedAt).toBe(3);
    const all = withRepeats(a, [t, f], '2026-11-10', 4, nid);
    const added = all.changes.putTasks.filter((x) => !['A', 'B'].includes(x.id));
    expect(added.map((x) => x.date)).toEqual(['2026-12-13']);
  });
});

describe('deleteSeries', () => {
  it('還沒完成的全部軟刪除，已完成的留著，整組都不再排新的', () => {
    const a = mk({ id: 'A', repeat: rep('2026-11-13') });
    const b = mk({ id: 'B', date: '2026-11-20', repeat: rep('2026-11-20') });
    const d = mk({ id: 'D', date: '2026-11-06', done: true, repeat: rep('2026-11-06') });
    const other = mk({ id: 'O', repeat: { ...rep('2026-11-13'), seriesId: 'zz' } });
    const act = deleteSeries([a, b, d, other], a, 7);
    const byId = Object.fromEntries(act.changes.putTasks.map((x) => [x.id, x]));
    expect(Object.keys(byId).sort()).toEqual(['A', 'B', 'D']);
    expect(byId.A.deletedAt).toBe(7);
    expect(byId.B.deletedAt).toBe(7);
    expect(byId.D.deletedAt).toBeUndefined();
    expect(act.message).toBe('已刪除 2 筆重複事項');
    // 套用後再補排：什麼都不會排
    expect(planRepeats(applyToTasks([a, b, d, other], act.changes), '2026-11-10', 8, nid).filter((t) => t.repeat?.seriesId === 's1')).toEqual([]);
  });
});

describe('repeatHint', () => {
  it('每週與每月的提示', () => {
    expect(repeatHint('weekly', '2026-11-13')).toBe('每五重複');
    expect(repeatHint('monthly', '2026-11-13')).toBe('每月 13 日重複');
    expect(repeatHint('monthly', '2026-01-31')).toContain('月底');
  });
});
