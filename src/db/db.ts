import Dexie, { type Table } from 'dexie';
import type { Note, Task } from '../types';

export interface FiredReminder {
  id: string;
  firedAt: number;
}

export interface KV {
  key: string;
  value: unknown;
}

export class AppDB extends Dexie {
  tasks!: Table<Task, string>;
  notes!: Table<Note, string>;
  kv!: Table<KV, string>;
  firedReminders!: Table<FiredReminder, string>;

  constructor(name = 'blue-week') {
    super(name);
    this.version(1).stores({
      tasks: 'id, date, done, deletedAt',
      notes: 'id, date, deletedAt',
      kv: 'key',
    });
    this.version(2).stores({
      firedReminders: 'id, firedAt',
    });
  }
}

export const db = new AppDB();
