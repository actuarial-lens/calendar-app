import type { Changes } from './changes';
import type { Note, Task } from '../types';

export const BACKUP_FORMAT = 'calendar-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  tasks: Task[];
  notes: Note[];
}

/** 匯出：只含事項與備忘；已刪除的不帶；不含通知與伺服器設定（密碼不外流） */
export function buildBackup(tasks: Task[], notes: Note[], now: number): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now,
    tasks: tasks.filter((t) => t.deletedAt === undefined),
    notes: notes.filter((n) => n.deletedAt === undefined),
  };
}

export const backupFileName = (today: string) => `calendar-backup-${today}.json`;

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isDate = (v: unknown): v is string => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);

function validTask(t: unknown): t is Task {
  const o = t as Record<string, unknown>;
  return (
    !!o && typeof o === 'object' &&
    isStr(o.id) && o.id !== '' && isDate(o.date) && isStr(o.time) &&
    (o.category === '會議' || o.category === '待辦' || o.category === '私人') &&
    isStr(o.title) && isStr(o.note) && typeof o.done === 'boolean' &&
    isNum(o.delayDays) && isNum(o.createdAt) && isNum(o.updatedAt) &&
    (o.important === undefined || typeof o.important === 'boolean')
  );
}
function validNote(n: unknown): n is Note {
  const o = n as Record<string, unknown>;
  return !!o && typeof o === 'object' && isStr(o.id) && o.id !== '' && isDate(o.date) && isStr(o.text) && isNum(o.createdAt) && isNum(o.updatedAt);
}

export type ParseResult = { ok: true; backup: Backup; skipped: number } | { ok: false; error: string };

/** 讀入檔案內容：格式不對就回報錯誤；個別壞掉的資料略過並計數 */
export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '這不是有效的備份檔。' };
  }
  const o = raw as Partial<Backup> | null;
  if (!o || typeof o !== 'object' || o.format !== BACKUP_FORMAT || !Array.isArray(o.tasks) || !Array.isArray(o.notes)) {
    return { ok: false, error: '這不是 Calendar 的備份檔。' };
  }
  if (!isNum(o.version) || o.version > BACKUP_VERSION) return { ok: false, error: '備份檔版本較新，請先更新 App。' };
  const tasks = o.tasks.filter(validTask).filter((t) => t.deletedAt === undefined);
  const notes = o.notes.filter(validNote).filter((n) => n.deletedAt === undefined);
  const skipped = o.tasks.length - tasks.length + (o.notes.length - notes.length);
  return { ok: true, backup: { ...(o as Backup), tasks, notes }, skipped };
}

export interface ImportPlan {
  changes: Changes;
  addedTasks: number;
  updatedTasks: number;
  addedNotes: number;
  updatedNotes: number;
}

/** 合併：id 相同時，較新（updatedAt 大）的留下；現有資料絕不刪除。 */
export function planImport(backup: Backup, tasks: Task[], notes: Note[]): ImportPlan {
  const haveT = new Map(tasks.map((t) => [t.id, t]));
  const haveN = new Map(notes.map((n) => [n.id, n]));
  const putTasks: Task[] = [];
  const putNotes: Note[] = [];
  let addedTasks = 0, updatedTasks = 0, addedNotes = 0, updatedNotes = 0;
  for (const t of backup.tasks) {
    const cur = haveT.get(t.id);
    if (!cur) { putTasks.push(t); addedTasks++; }
    else if (t.updatedAt > cur.updatedAt) { putTasks.push(t); updatedTasks++; }
  }
  for (const n of backup.notes) {
    const cur = haveN.get(n.id);
    if (!cur) { putNotes.push(n); addedNotes++; }
    else if (n.updatedAt > cur.updatedAt) { putNotes.push(n); updatedNotes++; }
  }
  return { changes: { putTasks, putNotes, delTaskIds: [], delNoteIds: [] }, addedTasks, updatedTasks, addedNotes, updatedNotes };
}

export function importSummary(p: ImportPlan, skipped: number): string {
  const n = p.addedTasks + p.updatedTasks + p.addedNotes + p.updatedNotes;
  if (n === 0 && skipped === 0) return '沒有需要匯入的新資料。';
  const parts = [`新增事項 ${p.addedTasks}、更新 ${p.updatedTasks}；新增備忘 ${p.addedNotes}、更新 ${p.updatedNotes}`];
  if (skipped) parts.push(`略過格式不符 ${skipped} 筆`);
  return '已匯入：' + parts.join('；') + '。';
}
