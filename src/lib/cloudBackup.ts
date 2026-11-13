import { LEAD_OPTIONS, type Note, type Settings, type Task } from '../types';
import { planImport, validNote, validTask, type ImportPlan } from './backup';
import { dayLabel, formatHM, toISO } from './dates';

// 雲端備份的純邏輯：還原碼、金鑰衍生、加密／解密、備份內容、合併。
// 伺服器只會看到「備份代號」（由還原碼算出、反推不回還原碼）與加密後的內容。

export const CLOUD_KEY = 'cloudBackup';
export const CLOUD_FORMAT = 'calendar-cloud-backup';
export const CLOUD_VERSION = 1;
/** 加密後內容的長度上限（和伺服器一致） */
export const MAX_BLOB_CHARS = 1_000_000;

/** 存在手機 IndexedDB `kv` 裡的雲端備份狀態 */
export interface CloudBackupState {
  code: string; // 還原碼（正規化後的 20 個字元）
  enabledAt: number;
  lastOkAt?: number;
  lastError?: string;
  lastHash?: string; // 上次成功上傳的內容雜湊；沒變就不上傳
}

// ---------- 還原碼 ----------
/** Crockford Base32：沒有 I、L、O、U */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 20;

/** 手機隨機產生：每個位元組取低 5 位元（256 可被 32 整除，沒有偏差），約 100 位元 */
export function generateCode(fill: (a: Uint8Array<ArrayBuffer>) => Uint8Array = (a) => crypto.getRandomValues(a)): string {
  const bytes = fill(new Uint8Array(new ArrayBuffer(CODE_LENGTH)));
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] & 31];
  return out;
}

/** 顯示用：K7QM-4RTX-9WBN-2HCE-PZ6D */
export const formatCode = (code: string): string => (code.match(/.{1,4}/g) ?? []).join('-');

/**
 * 使用者輸入的還原碼：去掉空白與「-」、轉大寫、O→0、I／L→1。
 * 不是 20 個有效字元就回 null。
 */
export function normalizeCode(input: string): string | null {
  const s = input.replace(/[\s-]+/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== CODE_LENGTH) return null;
  for (const c of s) if (!CODE_ALPHABET.includes(c)) return null;
  return s;
}

const te = new TextEncoder();
const SALT = te.encode('calendar-app-backup-v1');

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

async function hkdfBits(code: string, info: string): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey('raw', te.encode(code), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: te.encode(info) }, ikm, 256);
  return new Uint8Array(bits);
}

/** 由（已正規化的）還原碼衍生：備份代號（64 個十六進位字元）與 AES-GCM 256 金鑰 */
export async function deriveKeys(code: string): Promise<{ id: string; key: CryptoKey }> {
  const [idBits, keyBits] = await Promise.all([hkdfBits(code, 'id'), hkdfBits(code, 'key')]);
  const key = await crypto.subtle.importKey('raw', keyBits as BufferSource, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { id: hex(idBits), key };
}

// ---------- base64url ----------
export function b64uEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uDecode(str: string): Uint8Array {
  const raw = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// ---------- 備份內容 ----------
export interface CloudSettings {
  morningEnabled: boolean;
  morningTime: string;
  leadMinutes: number;
}

export interface CloudBackup {
  format: typeof CLOUD_FORMAT;
  version: number;
  exportedAt: number;
  tasks: Task[]; // 含軟刪除（有 deletedAt）還沒被清掉的，還原後刪掉的東西才不會復活
  notes: Note[];
  settings: CloudSettings;
}

/** 組出備份內容。只帶 3 個提醒設定；伺服器網址、公鑰、密碼、通知開關一律不備份 */
export function buildCloudBackup(tasks: Task[], notes: Note[], settings: Settings, now: number): CloudBackup {
  const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    format: CLOUD_FORMAT,
    version: CLOUD_VERSION,
    exportedAt: now,
    tasks: [...tasks].sort(byId),
    notes: [...notes].sort(byId),
    settings: { morningEnabled: settings.morningEnabled, morningTime: settings.morningTime, leadMinutes: settings.leadMinutes },
  };
}

/** 內容雜湊（不含 exportedAt）：資料沒變就不用再上傳 */
export async function backupHash(b: CloudBackup): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', te.encode(JSON.stringify({ tasks: b.tasks, notes: b.notes, settings: b.settings })));
  return hex(new Uint8Array(digest));
}

// ---------- 加密／解密 ----------
const BLOB_VERSION = 1;

/** 上傳的字串 ＝ base64url（0x01 版本位元組 ＋ 12 位元組 IV ＋ AES-GCM 密文）。iv 只給測試用 */
export async function encryptBackup(b: CloudBackup, key: CryptoKey, iv: Uint8Array = crypto.getRandomValues(new Uint8Array(12))): Promise<string> {
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, te.encode(JSON.stringify(b))));
  const out = new Uint8Array(1 + iv.length + cipher.length);
  out[0] = BLOB_VERSION;
  out.set(iv, 1);
  out.set(cipher, 1 + iv.length);
  return b64uEncode(out);
}

export class CloudError extends Error {
  constructor(
    public code: 'decrypt' | 'format' | 'version' | 'network' | 'auth' | 'no-db' | 'not-found' | 'too-large' | 'full' | 'server' | 'config',
    message: string,
  ) {
    super(message);
    this.name = 'CloudError';
  }
}

/** 解密並檢查格式。還原碼不對、內容被改過、格式不對都丟 CloudError */
export async function decryptBackup(blob: string, key: CryptoKey): Promise<{ backup: CloudBackup; skipped: number }> {
  let bytes: Uint8Array;
  try {
    bytes = b64uDecode(blob);
  } catch {
    throw new CloudError('decrypt', '還原碼不正確，或備份已損毀');
  }
  if (bytes.length < 1 + 12 + 16) throw new CloudError('decrypt', '還原碼不正確，或備份已損毀');
  if (bytes[0] !== BLOB_VERSION) throw new CloudError('version', '備份版本較新，請先更新 App');
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(1, 13) as BufferSource }, key, bytes.slice(13) as BufferSource);
  } catch {
    throw new CloudError('decrypt', '還原碼不正確，或備份已損毀');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new CloudError('decrypt', '還原碼不正確，或備份已損毀');
  }
  const parsed = parseCloudBackup(raw);
  if (!parsed.ok) throw new CloudError(parsed.version ? 'version' : 'decrypt', parsed.error);
  return { backup: parsed.backup, skipped: parsed.skipped };
}

export type ParsedCloud = { ok: true; backup: CloudBackup; skipped: number } | { ok: false; error: string; version?: boolean };

/** 檢查備份內容；個別壞掉的紀錄略過並計數。刪除過的紀錄（有 deletedAt）照樣接受 */
export function parseCloudBackup(raw: unknown): ParsedCloud {
  const o = raw as Partial<CloudBackup> | null;
  if (!o || typeof o !== 'object' || o.format !== CLOUD_FORMAT || !Array.isArray(o.tasks) || !Array.isArray(o.notes)) {
    return { ok: false, error: '還原碼不正確，或備份已損毀' };
  }
  if (typeof o.version !== 'number' || !Number.isFinite(o.version)) return { ok: false, error: '還原碼不正確，或備份已損毀' };
  if (o.version > CLOUD_VERSION) return { ok: false, error: '備份版本較新，請先更新 App', version: true };
  const tasks = o.tasks.filter(validTask);
  const notes = o.notes.filter(validNote);
  const skipped = o.tasks.length - tasks.length + (o.notes.length - notes.length);
  const s = (o.settings ?? {}) as Partial<CloudSettings>;
  const settings: CloudSettings = {
    morningEnabled: typeof s.morningEnabled === 'boolean' ? s.morningEnabled : true,
    morningTime: typeof s.morningTime === 'string' && /^\d{1,2}:\d{2}$/.test(s.morningTime) ? s.morningTime : '08:30',
    leadMinutes: typeof s.leadMinutes === 'number' && LEAD_OPTIONS.includes(s.leadMinutes) ? s.leadMinutes : 30,
  };
  return { ok: true, backup: { ...(o as CloudBackup), tasks, notes, settings }, skipped };
}

/** 備份裡有寫的設定（沒寫或不合格的欄位不動手機現有的設定） */
export function settingsPatchFrom(raw: unknown): Partial<Settings> {
  const s = ((raw as { settings?: unknown } | null)?.settings ?? {}) as Partial<CloudSettings>;
  const patch: Partial<Settings> = {};
  if (typeof s.morningEnabled === 'boolean') patch.morningEnabled = s.morningEnabled;
  if (typeof s.morningTime === 'string' && /^\d{1,2}:\d{2}$/.test(s.morningTime)) patch.morningTime = s.morningTime;
  if (typeof s.leadMinutes === 'number' && LEAD_OPTIONS.includes(s.leadMinutes)) patch.leadMinutes = s.leadMinutes;
  return patch;
}

// ---------- 還原：合併 ----------
export interface RestorePlan extends ImportPlan {
  /** 備份裡這幾種紀錄，顯示用的件數：新增只算沒被刪掉的；更新算所有被備份取代的 */
  shownAddedTasks: number;
  shownAddedNotes: number;
}

/**
 * 合併規則和手動匯入的 planImport 相同（依 id、updatedAt 較新的留下、絕不刪除現有資料），
 * 但備份裡有 deletedAt 的紀錄也要帶進來（手動匯入在讀檔時就已經把它們略過）。
 */
export function planCloudRestore(backup: CloudBackup, tasks: Task[], notes: Note[]): RestorePlan {
  const plan = planImport(backup, tasks, notes);
  const haveT = new Set(tasks.map((t) => t.id));
  const haveN = new Set(notes.map((n) => n.id));
  return {
    ...plan,
    shownAddedTasks: plan.changes.putTasks.filter((t) => !haveT.has(t.id) && !t.deletedAt).length,
    shownAddedNotes: plan.changes.putNotes.filter((n) => !haveN.has(n.id) && !n.deletedAt).length,
  };
}

export function restoreSummary(p: RestorePlan): string {
  const n = p.shownAddedTasks + p.updatedTasks + p.shownAddedNotes + p.updatedNotes;
  if (n === 0 && p.changes.putTasks.length === 0 && p.changes.putNotes.length === 0) return '雲端的資料這支手機都已經有了，沒有需要還原的。';
  return `已還原：新增事項 ${p.shownAddedTasks}、更新 ${p.updatedTasks}；新增隨手記 ${p.shownAddedNotes}、更新 ${p.updatedNotes}`;
}

// ---------- 小工具 ----------
/** 雲端備份只需要伺服器網址與密碼（公鑰不需要，所以不用 isPushConfigured） */
export const isCloudReady = (s: Pick<Settings, 'push'>): boolean => s.push.endpoint.trim() !== '' && s.push.secret.trim() !== '';

/** 「今天 22:40」或「11/12（四）08:15」 */
export function backupTimeText(ts: number, today: string): string {
  const d = toISO(new Date(ts));
  return `${d === today ? '今天 ' : dayLabel(d)}${formatHM(ts)}`;
}

/** 還原清單的每一列：「11/13（五）22:40」 */
export const restoreItemText = (day: string, updatedAt: number): string => `${dayLabel(day)}${formatHM(updatedAt)}`;
