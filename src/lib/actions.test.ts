import { describe, expect, it } from 'vitest';
import type { Note, Task } from '../types';
import { completeTask, deleteNote, deleteTask, delayNote, delayTask, noteToTask, restoreTask, saveForm } from './actions';
import { formFromTask, formTime, newForm, quickDates } from './editor';

const task = (p: Partial<Task> = {}): Task => ({
  id: 't1', date: '2026-11-10', time: '14:00', category: '會議', title: '對稿', note: '備註',
  done: false, delayDays: 0, createdAt: 1, updatedAt: 1, ...p,
});
const note = (p: Partial<Note> = {}): Note => ({ id: 'n1', date: '2026-11-10', text: '買電池', createdAt: 1, updatedAt: 1, ...p });
const NOW = 5000;

describe('任務動作', () => {
  it('完成／恢復', () => {
    const done = completeTask(task(), NOW);
    expect(done.changes.putTasks[0]).toMatchObject({ done: true, doneAt: NOW });
    expect(done.message).toBe('已完成');
    const back = restoreTask(done.changes.putTasks[0], NOW + 1);
    expect(back.changes.putTasks[0].done).toBe(false);
    expect('doneAt' in back.changes.putTasks[0]).toBe(false);
    expect(back.message).toBe('已恢復為未完成');
  });

  it('延後：日期 +1、delayDays +1、保留時間，提示含日期', () => {
    const a = delayTask(task({ delayDays: 2, date: '2026-11-11' }), NOW);
    expect(a.changes.putTasks[0]).toMatchObject({ date: '2026-11-12', delayDays: 3, time: '14:00' });
    expect(a.message).toBe('已延到 11/12（四）');
  });

  it('延後跨月', () => {
    expect(delayTask(task({ date: '2026-11-30' }), NOW).changes.putTasks[0].date).toBe('2026-12-01');
  });

  it('刪除是軟刪除', () => {
    const a = deleteTask(task(), NOW);
    expect(a.changes.putTasks[0].deletedAt).toBe(NOW);
    expect(a.changes.delTaskIds).toEqual([]);
    expect(a.message).toBe('已刪除');
  });
});

describe('隨手記動作', () => {
  it('延後只改日期（隨手記沒有 delayDays）', () => {
    const a = delayNote(note(), NOW);
    expect(a.changes.putNotes[0].date).toBe('2026-11-11');
    expect(a.message).toBe('已延到 11/11（三）');
  });

  it('刪除是軟刪除', () => {
    expect(deleteNote(note(), NOW).changes.putNotes[0].deletedAt).toBe(NOW);
  });

  it('轉待辦：同一天、不設時間、待辦、標題是內容，原隨手記移除', () => {
    const a = noteToTask(note({ date: '2026-11-12' }), NOW, 'new1');
    expect(a.changes.putTasks[0]).toMatchObject({
      id: 'new1', date: '2026-11-12', time: '', category: '待辦', title: '買電池', done: false, delayDays: 0,
    });
    expect(a.changes.putNotes[0].deletedAt).toBe(NOW);
    expect(a.message).toBe('已轉為待辦');
  });
});

describe('編輯表單', () => {
  it('新增是空白，預設待辦、不設時間、日期為目前看的那天', () => {
    expect(newForm('2026-11-12')).toMatchObject({ mode: 'new', title: '', date: '2026-11-12', category: '待辦', timeMode: '' });
  });

  it('編輯帶入原內容；指定時間 → pick', () => {
    const f = formFromTask(task());
    expect(f).toMatchObject({ mode: 'edit', id: 't1', title: '對稿', timeMode: 'pick', timeVal: '14:00' });
    expect(formFromTask(task({ time: '下午' }))).toMatchObject({ timeMode: '下午' });
    expect(formFromTask(task({ time: '' }))).toMatchObject({ timeMode: '' });
  });

  it('formTime：不設／上午／下午／指定', () => {
    const base = newForm('2026-11-10');
    expect(formTime({ ...base, timeMode: '' })).toBe('');
    expect(formTime({ ...base, timeMode: '上午' })).toBe('上午');
    expect(formTime({ ...base, timeMode: '下午' })).toBe('下午');
    expect(formTime({ ...base, timeMode: 'pick', timeVal: '09:05' })).toBe('09:05');
    expect(formTime({ ...base, timeMode: 'pick', timeVal: '' })).toBe('');
  });

  it('今天／明天／後天', () => {
    expect(quickDates('2026-11-30')).toEqual(['2026-11-30', '2026-12-01', '2026-12-02']);
  });

  it('事項是空的不能儲存（空白字元也算空）', () => {
    expect(saveForm({ ...newForm('2026-11-10'), title: '   ' }, undefined, NOW, 'x')).toBeNull();
  });

  it('新增：標題去頭尾空白，提示含日期', () => {
    const a = saveForm({ ...newForm('2026-11-12'), title: ' 開會 ', timeMode: 'pick', timeVal: '10:30', category: '會議' }, undefined, NOW, 'id9')!;
    expect(a.changes.putTasks[0]).toMatchObject({ id: 'id9', title: '開會', date: '2026-11-12', time: '10:30', category: '會議', note: '', done: false, delayDays: 0 });
    expect(a.message).toBe('已新增到 11/12（四）');
  });

  it('編輯：改日期 → 「已移到」；沒改日期 → 「已更新」；備註與延後天數保留', () => {
    const t = task({ delayDays: 2 });
    const moved = saveForm({ ...formFromTask(t), date: '2026-11-13' }, t, NOW, 'x')!;
    expect(moved.message).toBe('已移到 11/13（五）');
    expect(moved.changes.putTasks[0]).toMatchObject({ id: 't1', date: '2026-11-13', note: '備註', delayDays: 2 });
    const same = saveForm({ ...formFromTask(t), title: '新標題' }, t, NOW, 'x')!;
    expect(same.message).toBe('已更新');
    expect(same.changes.putTasks[0].title).toBe('新標題');
  });
});
