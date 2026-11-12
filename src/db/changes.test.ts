import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { completeTask, delayNote, delayTask, deleteNote, deleteTask, noteToTask, restoreTask, saveForm } from '../lib/actions';
import { formFromTask, newForm } from '../lib/editor';
import type { Note, Task } from '../types';
import { commit } from './changes';
import { AppDB } from './db';

let db: AppDB;
let n = 0;
const task = (p: Partial<Task> = {}): Task => ({
  id: 't1', date: '2026-11-10', time: '14:00', category: '會議', title: '對稿', note: '備註',
  done: false, delayDays: 0, createdAt: 1, updatedAt: 1, ...p,
});
const note = (p: Partial<Note> = {}): Note => ({ id: 'n1', date: '2026-11-10', text: '買電池', createdAt: 1, updatedAt: 1, ...p });

const snapshot = async () => ({ tasks: await db.tasks.orderBy('id').toArray(), notes: await db.notes.orderBy('id').toArray() });

beforeEach(async () => {
  db = new AppDB('changes-' + n++);
  await db.open();
  await db.tasks.bulkAdd([task(), task({ id: 't2', done: true, doneAt: 3 })]);
  await db.notes.add(note());
});

/** 做一個動作，再復原，資料要和動作前完全一樣 */
async function roundTrip(make: () => { changes: Parameters<typeof commit>[1] }) {
  const before = await snapshot();
  const inverse = await commit(db, make().changes);
  expect(await snapshot()).not.toEqual(before);
  await commit(db, inverse);
  expect(await snapshot()).toEqual(before);
}

describe('動作 → 復原 會回到動作前', () => {
  it('完成', () => roundTrip(() => completeTask(task(), 10)));
  it('恢復', async () => roundTrip(() => restoreTask((task({ id: 't2', done: true, doneAt: 3 })), 10)));
  it('延後事項', () => roundTrip(() => delayTask(task(), 10)));
  it('刪除事項', () => roundTrip(() => deleteTask(task(), 10)));
  it('延後隨手記', () => roundTrip(() => delayNote(note(), 10)));
  it('刪除隨手記', () => roundTrip(() => deleteNote(note(), 10)));
  it('轉待辦（新增事項、移除隨手記）', () => roundTrip(() => noteToTask(note(), 10, 'new1')));
  it('新增事項', () => roundTrip(() => saveForm({ ...newForm('2026-11-12'), title: '新事項' }, undefined, 10, 'new2')!));
  it('編輯並改日期', () => roundTrip(() => saveForm({ ...formFromTask(task()), date: '2026-11-13', title: '改' }, task(), 10, 'x')!));
});

describe('commit', () => {
  it('復原後，新增的事項真的被刪掉', async () => {
    const inverse = await commit(db, noteToTask(note(), 10, 'new1').changes);
    expect(await db.tasks.get('new1')).toBeTruthy();
    expect((await db.notes.get('n1'))!.deletedAt).toBe(10);
    await commit(db, inverse);
    expect(await db.tasks.get('new1')).toBeUndefined();
    expect((await db.notes.get('n1'))!.deletedAt).toBeUndefined();
  });

  it('什麼都沒變更時不出錯', async () => {
    const inverse = await commit(db, {});
    expect(inverse).toEqual({ putTasks: [], putNotes: [], delTaskIds: [], delNoteIds: [] });
  });
});
