import type { Changes } from '../lib/changes';
import type { AppDB } from './db';

/**
 * 套用一組變更，並回傳「反向變更」（用來復原）：
 * - 被修改或被刪除的列 → 放回原本的樣子
 * - 原本不存在、這次新增的列 → 刪掉
 */
export async function commit(db: AppDB, c: Partial<Changes>): Promise<Changes> {
  const putTasks = c.putTasks ?? [];
  const putNotes = c.putNotes ?? [];
  const delTaskIds = c.delTaskIds ?? [];
  const delNoteIds = c.delNoteIds ?? [];

  return db.transaction('rw', db.tasks, db.notes, async () => {
    const touchedTasks = [...putTasks.map((t) => t.id), ...delTaskIds];
    const touchedNotes = [...putNotes.map((n) => n.id), ...delNoteIds];
    const prevTasks = (await db.tasks.bulkGet(touchedTasks)).filter((t): t is NonNullable<typeof t> => !!t);
    const prevNotes = (await db.notes.bulkGet(touchedNotes)).filter((n): n is NonNullable<typeof n> => !!n);
    const hadTask = new Set(prevTasks.map((t) => t.id));
    const hadNote = new Set(prevNotes.map((n) => n.id));

    await db.tasks.bulkDelete(delTaskIds);
    await db.notes.bulkDelete(delNoteIds);
    await db.tasks.bulkPut(putTasks);
    await db.notes.bulkPut(putNotes);

    return {
      putTasks: prevTasks,
      putNotes: prevNotes,
      delTaskIds: putTasks.filter((t) => !hadTask.has(t.id)).map((t) => t.id),
      delNoteIds: putNotes.filter((n) => !hadNote.has(n.id)).map((n) => n.id),
    };
  });
}
