import type { Note, Task } from '../types';

/** 一次動作造成的資料變更。復原 = 套用它的「反向變更」。 */
export interface Changes {
  putTasks: Task[];
  putNotes: Note[];
  delTaskIds: string[];
  delNoteIds: string[];
}

export interface Action {
  changes: Changes;
  message: string; // 復原提示上的文字
}

export const emptyChanges = (): Changes => ({ putTasks: [], putNotes: [], delTaskIds: [], delNoteIds: [] });
