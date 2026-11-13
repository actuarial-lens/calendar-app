import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudError, decryptBackup, deriveKeys, type CloudBackupState } from '../lib/cloudBackup';
import { DEFAULT_SETTINGS, type Note, type Task } from '../types';
import { CloudUploader, KEEPALIVE_MAX_CHARS, UPLOAD_DELAY_MS, type UploaderDeps } from './cloudSync';

const CODE = '0123456789ABCDEFGHJK';
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, date: '2026-11-13', time: '', category: '待辦', title: id, note: '', done: false, delayDays: 0, createdAt: 1, updatedAt: 1, ...extra,
});

function setup(initial: Partial<CloudBackupState> | null = {}, over: Partial<UploaderDeps> = {}) {
  let state: CloudBackupState | undefined = initial === null ? undefined : { code: CODE, enabledAt: 1, ...initial };
  const data = { tasks: [task('a')] as Task[], notes: [] as Note[], settings: { ...DEFAULT_SETTINGS } };
  const puts: { id: string; day: string; blob: string; keepalive: boolean }[] = [];
  let failNext: Error | null = null;
  let clock = 1_800_000_000_000;
  const deps: UploaderDeps = {
    loadState: async () => (state ? { ...state } : undefined),
    patchState: async (set, remove = []) => {
      if (!state) return;
      state = { ...state, ...set };
      for (const k of remove) delete state[k];
    },
    readSnapshot: async () => ({ tasks: [...data.tasks], notes: [...data.notes], settings: data.settings }),
    config: async () => ({ endpoint: 'https://w.example.com', secret: 'pw' }),
    put: async (_c, a) => {
      if (failNext) {
        const e = failNext;
        failNext = null;
        throw e;
      }
      puts.push(a);
    },
    now: () => clock,
    today: () => '2026-11-13',
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    ...over,
  };
  return { up: new CloudUploader(deps), data, puts, getState: () => state, failOnce: (e: Error) => (failNext = e), tick: (ms: number) => (clock += ms) };
}

/** 加密用真的 WebCrypto（不受假計時器控制），所以要等結果出現 */
const until = (fn: () => void) => vi.waitFor(fn, { timeout: 4000, interval: 5 });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('CloudUploader：30 秒合併上傳', () => {
  it('修改後 30 秒才上傳；期間再修改就重新計時，連續修改只傳一次', async () => {
    const { up, puts, data } = setup();
    up.markDirty();
    await vi.advanceTimersByTimeAsync(UPLOAD_DELAY_MS - 1000);
    expect(puts).toHaveLength(0);
    data.tasks.push(task('b'));
    up.markDirty(); // 重新計時
    await vi.advanceTimersByTimeAsync(UPLOAD_DELAY_MS - 1000);
    expect(puts).toHaveLength(0);
    expect(up.hasPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    await until(() => expect(puts).toHaveLength(1));
    await until(() => expect(up.hasPending()).toBe(false));
    // 上傳的是最新資料（含 b）
    const { key } = await deriveKeys(CODE);
    expect((await decryptBackup(puts[0].blob, key)).backup.tasks.map((t) => t.id)).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(puts).toHaveLength(1);
  });

  it('上傳帶手機當地今天的日期與備份代號；成功後記 lastHash、lastOkAt，清掉 lastError', async () => {
    const { up, puts, getState } = setup({ lastError: '舊的錯誤' });
    const r = await up.flush();
    expect(r).toEqual({ ok: true });
    expect(puts[0].day).toBe('2026-11-13');
    expect(puts[0].id).toBe((await deriveKeys(CODE)).id);
    const s = getState()!;
    expect(s.lastHash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.lastOkAt).toBe(1_800_000_000_000);
    expect('lastError' in s).toBe(false);
  });

  it('內容和上次成功上傳的一樣：不上傳；有變才上傳', async () => {
    const { up, puts, data } = setup();
    await up.flush();
    expect(puts).toHaveLength(1);
    expect(await up.flush()).toEqual({ ok: true, skipped: true });
    expect(puts).toHaveLength(1);
    data.tasks[0] = { ...data.tasks[0], title: '改了' };
    await up.flush();
    expect(puts).toHaveLength(2);
  });

  it('設定（3 個提醒設定）變了也算有變；伺服器網址、密碼、通知開關變了不算', async () => {
    const { up, puts, data } = setup();
    await up.flush();
    data.settings = { ...data.settings, push: { endpoint: 'https://other', vapidPublicKey: 'k', secret: 'x' }, notificationsEnabled: true };
    expect((await up.flush()).skipped).toBe(true);
    data.settings = { ...data.settings, morningTime: '09:15' };
    expect((await up.flush()).skipped).toBeUndefined();
    expect(puts).toHaveLength(2);
  });

  it('force（立即備份）：內容沒變也上傳', async () => {
    const { up, puts } = setup();
    await up.flush();
    await up.flush({ force: true });
    expect(puts).toHaveLength(2);
  });

  it('沒開啟雲端備份、或還沒填伺服器網址與密碼：什麼都不傳，也不算待上傳', async () => {
    const off = setup(null);
    off.up.markDirty();
    await vi.advanceTimersByTimeAsync(UPLOAD_DELAY_MS + 1);
    expect(off.puts).toHaveLength(0);
    expect(off.up.hasPending()).toBe(false);
    const noCfg = setup({}, { config: async () => null });
    expect(await noCfg.up.flush()).toEqual({ ok: true, skipped: true });
    expect(noCfg.puts).toHaveLength(0);
  });
});

describe('CloudUploader：切到背景、失敗重試', () => {
  it('keepalive：只在要求時、而且內容小於 60KB 才帶', async () => {
    const small = setup();
    await small.up.flush({ keepalive: true });
    expect(small.puts[0].keepalive).toBe(true);
    const normal = setup();
    await normal.up.flush();
    expect(normal.puts[0].keepalive).toBe(false);
    // 隨機內容壓不動：備註塞很多隨機字讓加密後超過 60KB
    const big = setup();
    const rnd = Array.from({ length: 60_000 }, (_, i) => String.fromCharCode(0x4e00 + ((i * 7919) % 5000))).join('');
    big.data.tasks[0] = { ...big.data.tasks[0], note: rnd };
    await big.up.flush({ keepalive: true });
    expect(big.puts[0].blob.length).toBeGreaterThan(KEEPALIVE_MAX_CHARS);
    expect(big.puts[0].keepalive).toBe(false);
  });

  it('失敗：記 lastError、維持待上傳；retryIfFailed 重試成功後清掉 lastError', async () => {
    const { up, puts, getState, failOnce } = setup();
    up.markDirty();
    failOnce(new CloudError('network', '連不上伺服器，請檢查網路'));
    await vi.advanceTimersByTimeAsync(UPLOAD_DELAY_MS + 10);
    await until(() => expect(getState()!.lastError).toBe('連不上伺服器，請檢查網路'));
    expect(puts).toHaveLength(0);
    expect(up.hasPending()).toBe(true);
    const retry = up.retryIfFailed();
    expect(retry).not.toBeNull();
    expect((await retry!).ok).toBe(true);
    expect(puts).toHaveLength(1);
    expect('lastError' in getState()!).toBe(false);
    expect(up.hasPending()).toBe(false);
    expect(up.retryIfFailed()).toBeNull(); // 沒有待上傳就不重試
  });

  it('沒有失敗過、只是還在等 30 秒：retryIfFailed 不提前上傳', () => {
    const { up } = setup();
    up.markDirty();
    expect(up.retryIfFailed()).toBeNull();
  });

  it('失敗一次後連續重試：每次都再試（直到成功），不會卡住', async () => {
    const { up, puts, failOnce } = setup();
    up.markDirty();
    failOnce(new Error('伺服器回應 500，請檢查設定'));
    await up.flush();
    failOnce(new Error('伺服器回應 500，請檢查設定'));
    expect((await up.retryIfFailed()!).ok).toBe(false);
    expect((await up.retryIfFailed()!).ok).toBe(true);
    expect(puts).toHaveLength(1);
  });

  it('上傳到一半又有修改：上傳完仍算待上傳，之後會再傳一次', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const sent: unknown[] = [];
    let entered = false;
    const { up, data } = setup({}, {
      put: async (_c, a) => {
        entered = true;
        await gate;
        sent.push(a);
      },
    });
    const first = up.flush();
    await until(() => expect(entered).toBe(true));
    data.tasks.push(task('late'));
    up.markDirty();
    release();
    await first;
    expect(up.hasPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(UPLOAD_DELAY_MS + 10);
    await until(() => expect(sent.length).toBe(2));
    expect(up.hasPending()).toBe(false);
  });

  it('同時兩個 flush 不會同時上傳（排隊）', async () => {
    let active = 0;
    let maxActive = 0;
    const { up } = setup({}, {
      put: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        for (let i = 0; i < 5; i++) await Promise.resolve();
        active -= 1;
      },
    });
    const a = up.flush({ force: true });
    const b = up.flush({ force: true });
    await Promise.all([a, b]);
    expect(maxActive).toBe(1);
  });
});
