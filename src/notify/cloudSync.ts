import type { CloudConfig } from '../lib/cloudApi';
import { CloudError, MAX_BLOB_CHARS, backupHash, buildCloudBackup, deriveKeys, encryptBackup, type CloudBackupState } from '../lib/cloudBackup';
import type { Note, Settings, Task } from '../types';

/** 最後一次修改後等多久才上傳（連續修改會合成一次） */
export const UPLOAD_DELAY_MS = 30_000;
/** 失敗後，App 開在前景時每隔多久重試 */
export const RETRY_MS = 60_000;
/** 切到背景時用 keepalive 上傳：瀏覽器限制內容不能超過 64KB，保守抓 60,000 字元 */
export const KEEPALIVE_MAX_CHARS = 60_000;

export interface UploaderDeps {
  loadState(): Promise<CloudBackupState | undefined>;
  /** set：要寫入的欄位；remove：要拿掉的欄位 */
  patchState(set: Partial<CloudBackupState>, remove?: (keyof CloudBackupState)[]): Promise<void>;
  readSnapshot(): Promise<{ tasks: Task[]; notes: Note[]; settings: Settings }>;
  /** 伺服器網址與密碼；還沒填就回 null */
  config(): Promise<CloudConfig | null>;
  put(cfg: CloudConfig, a: { id: string; day: string; blob: string; keepalive: boolean }): Promise<void>;
  now(): number;
  today(): string;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(h: unknown): void;
}

export interface FlushResult {
  ok: boolean;
  /** 沒有上傳：沒開啟、沒填伺服器、或內容和上次一樣 */
  skipped?: boolean;
  error?: string;
}

/**
 * 自動上傳：資料有變動就排一個 30 秒的計時（期間再有變動就重新計時）；
 * 時間到、切到背景、App 開啟時，會讀出全部資料、算雜湊，和上次成功上傳的一樣就不傳，不一樣才加密上傳。
 * 失敗時記下原因，維持「待上傳」，由 retryIfFailed（每 60 秒、恢復連線時）重試。
 */
export class CloudUploader {
  private seq = 0; // 每次標記「有變動」就加一；上傳期間又有變動的話，上傳完仍算待上傳
  private dirty = false;
  private failed = false;
  private timer: unknown;
  private running: Promise<FlushResult> | null = null;

  constructor(private deps: UploaderDeps) {}

  hasPending(): boolean {
    return this.dirty;
  }

  /** 資料有變動：30 秒後上傳 */
  markDirty(): void {
    this.seq += 1;
    this.dirty = true;
    this.deps.clearTimer(this.timer);
    this.timer = this.deps.setTimer(() => void this.flush(), UPLOAD_DELAY_MS);
  }

  /** 上次失敗、還有待上傳時重試（App 在前景的每 60 秒、恢復連線時呼叫） */
  retryIfFailed(): Promise<FlushResult> | null {
    return this.dirty && this.failed ? this.flush() : null;
  }

  dispose(): void {
    this.deps.clearTimer(this.timer);
  }

  /** 立刻上傳。force：不比對雜湊（「立即備份」）；keepalive：切到背景時用 */
  async flush(opts: { force?: boolean; keepalive?: boolean } = {}): Promise<FlushResult> {
    // 同時只做一件事；做的時候又被要求，就等這一輪做完再跑一次
    while (this.running) await this.running.catch(() => undefined);
    const run = this.doFlush(opts);
    this.running = run;
    try {
      return await run;
    } finally {
      this.running = null;
    }
  }

  private async doFlush(opts: { force?: boolean; keepalive?: boolean }): Promise<FlushResult> {
    this.deps.clearTimer(this.timer);
    const [state, cfg] = await Promise.all([this.deps.loadState(), this.deps.config()]);
    if (!state || !cfg) {
      this.dirty = false;
      this.failed = false;
      return { ok: true, skipped: true };
    }
    const seqAtStart = this.seq;
    try {
      const snap = await this.deps.readSnapshot();
      const backup = buildCloudBackup(snap.tasks, snap.notes, snap.settings, this.deps.now());
      const hash = await backupHash(backup);
      if (!opts.force && hash === state.lastHash) {
        if (state.lastError) await this.deps.patchState({}, ['lastError']);
        this.finish(seqAtStart, true);
        return { ok: true, skipped: true };
      }
      const { id, key } = await deriveKeys(state.code);
      const blob = await encryptBackup(backup, key);
      if (blob.length > MAX_BLOB_CHARS) throw new CloudError('too-large', '資料太大，無法備份');
      await this.deps.put(cfg, { id, day: this.deps.today(), blob, keepalive: !!opts.keepalive && blob.length < KEEPALIVE_MAX_CHARS });
      await this.deps.patchState({ lastHash: hash, lastOkAt: this.deps.now() }, ['lastError']);
      this.finish(seqAtStart, true);
      return { ok: true };
    } catch (e) {
      const error = e instanceof Error && e.message ? e.message : '備份失敗';
      await this.deps.patchState({ lastError: error }).catch(() => undefined);
      this.dirty = true;
      this.failed = true;
      return { ok: false, error };
    }
  }

  private finish(seqAtStart: number, ok: boolean): void {
    this.failed = !ok;
    if (ok && this.seq === seqAtStart) this.dirty = false;
  }
}
