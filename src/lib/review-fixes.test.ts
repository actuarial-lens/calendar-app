// 2026-11-13 審查報告修正：第 2、6、8 項
import { describe, expect, it } from 'vitest';
import { delayTask, saveForm } from './actions';
import { formFromTask } from './editor';
import { applyToTasks, deleteSeries, planRepeats, repeatChanged, repeatHint, repeatStart } from './repeat';
import type { Task } from '../types';

let n = 0;
const nid = () => 'g' + ++n;
const mk = (over: Partial<Task> = {}): Task => ({
  id: 'x' + ++n, date: '2026-11-16', time: '09:00', category: '待辦', title: '週會', note: '',
  done: false, delayDays: 0, createdAt: 1, updatedAt: 1, ...over,
});
const weekly = (date: string, extra = {}) => ({ seriesId: 's1', freq: 'weekly' as const, anchor: '2026-11-16', occurrence: date, ...extra });

describe('第 2 項：已結束的重複事項不會復活', () => {
  it('刪除全部後，到「已完成」打開留下的那筆直接儲存：不另開新的一組', () => {
    const done = mk({ id: 'd', done: true, repeat: weekly('2026-11-16') });
    const next = mk({ id: 'n', date: '2026-11-23', repeat: weekly('2026-11-23') });
    const after = applyToTasks([done, next], deleteSeries([done, next], next, 5).changes);
    const kept = after.find((t) => t.id === 'd')!;
    expect(repeatChanged(kept, formFromTask(kept))).toBe(false);
    const put = saveForm(formFromTask(kept), kept, 6, 'z', after, 's2')!.changes.putTasks;
    expect(put).toHaveLength(1);
    expect(put[0].repeat!.seriesId).toBe('s1');
    expect(planRepeats(applyToTasks(after, { putTasks: put, delTaskIds: [], putNotes: [], delNoteIds: [] } as never), '2026-11-16', 7, nid)).toEqual([]);
  });

  it('最後一筆被延後超過結束日，再編輯儲存：不另開新的一組', () => {
    const t = mk({ date: '2026-12-01', delayDays: 2, repeat: weekly('2026-11-29', { until: '2026-11-30' }) });
    expect(repeatChanged(t, formFromTask(t))).toBe(false);
  });

  it('真的改了結束日、或拿掉結束日，仍算改了', () => {
    const t = mk({ repeat: weekly('2026-11-16', { until: '2026-12-31' }) });
    expect(repeatChanged(t, { ...formFromTask(t), until: '2027-01-31' })).toBe(true);
    expect(repeatChanged(t, { ...formFromTask(t), until: '' })).toBe(true);
  });
});

describe('第 6 項：改重複設定時沿用原本的起始日', () => {
  it('被延後到週二的週一事項，加上結束日：之後仍是每週一', () => {
    const mon = mk({ id: 'm', repeat: weekly('2026-11-16') });
    const tue = delayTask(mon, 2).changes.putTasks[0];
    expect(tue.date).toBe('2026-11-17');
    const put = saveForm({ ...formFromTask(tue), until: '2027-01-31' }, tue, 3, 'z', [tue], 's2')!.changes.putTasks;
    const rep = put[0].repeat!;
    expect(rep).toMatchObject({ seriesId: 's2', anchor: '2026-11-16', occurrence: '2026-11-16', until: '2027-01-31' });
    const more = planRepeats(applyToTasks([tue], { putTasks: put, delTaskIds: [], putNotes: [], delNoteIds: [] } as never), '2026-11-17', 4, nid);
    expect(more.length).toBeGreaterThan(0);
    expect(more.every((x) => new Date(x.date + 'T12:00').getDay() === 1)).toBe(true);
  });

  it('每月 31 日落在 2/28 的那筆，改結束日：之後仍是每月 31 日（月底）', () => {
    const feb = mk({ date: '2027-02-28', repeat: { seriesId: 's1', freq: 'monthly', anchor: '2027-01-31', occurrence: '2027-02-28' } });
    const put = saveForm({ ...formFromTask(feb), until: '2027-12-31' }, feb, 3, 'z', [feb], 's2')!.changes.putTasks;
    expect(put[0].repeat).toMatchObject({ anchor: '2027-01-31', occurrence: '2027-02-28' });
  });

  it('自己改了日期就以新日期為準；換頻率以原定日期為準', () => {
    const t = mk({ date: '2026-11-17', repeat: weekly('2026-11-16') });
    expect(repeatStart(t, { repeat: 'weekly', date: '2026-11-20' })).toEqual({ anchor: '2026-11-20', occurrence: '2026-11-20' });
    expect(repeatStart(t, { repeat: 'monthly', date: '2026-11-17' })).toEqual({ anchor: '2026-11-16', occurrence: '2026-11-16' });
    expect(repeatStart(null, { repeat: 'weekly', date: '2026-11-20' })).toEqual({ anchor: '2026-11-20', occurrence: '2026-11-20' });
  });

  it('提示文字用同一個起始日', () => {
    const t = mk({ date: '2026-11-17', repeat: weekly('2026-11-16') });
    expect(repeatHint('weekly', repeatStart(t, { repeat: 'weekly', date: t.date }).anchor)).toBe('每一重複');
  });
});

describe('第 8 項：改了時間就照新時間排', () => {
  it('同時段改時間會拿掉手動順序', () => {
    const t = mk({ order: 2 });
    expect(saveForm({ ...formFromTask(t), timeVal: '11:30' }, t, 5, 'z')!.changes.putTasks[0].order).toBeUndefined();
    expect(saveForm({ ...formFromTask(t), title: '新' }, t, 5, 'z')!.changes.putTasks[0].order).toBe(2);
  });
});
