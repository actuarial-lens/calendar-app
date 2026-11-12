import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReminderStore, loadSettings, saveSettings } from '../db/settings';
import { AppDB } from '../db/db';
import { atLocal, type Reminder } from '../lib/reminders';
import { DEFAULT_SETTINGS, type Settings, type Task } from '../types';
import { LocalProvider, drainDue, type ReminderStore } from './local';
import { NotificationManager } from './manager';
import { PushProvider, buildPushPayload, isPushConfigured, subscribeToPush, testPushServer, urlBase64ToUint8Array, type PushDeps } from './push';
import type { NotificationProvider, SyncContext } from './types';

const at = (d: string, hm: string) => atLocal(d, hm)!;
const S = (p: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, notificationsEnabled: true, ...p });
const task = (p: Partial<Task> & { id: string }): Task => ({
  date: '2026-11-10', time: '14:00', category: '會議', title: p.id, note: '',
  done: false, delayDays: 0, createdAt: 1, updatedAt: 1, ...p,
});
const ctx = (tasks: Task[], now: number, settings = S()): SyncContext => ({ tasks, settings, now });

function memoryStore(lastSeen?: number): ReminderStore & { fired: Set<string>; lastSeen?: number } {
  const st = {
    fired: new Set<string>(),
    lastSeen,
    firedIds: async (ids: string[]) => new Set(ids.filter((i) => st.fired.has(i))),
    markFired: async (ids: string[]) => ids.forEach((i) => st.fired.add(i)),
    getLastSeen: async () => st.lastSeen,
    setLastSeen: async (ts: number) => {
      st.lastSeen = ts;
    },
  };
  return st;
}

describe('LocalProvider（App 開著時的本機提醒）', () => {
  const t = [task({ id: 'a', title: '對稿', time: '14:00' })]; // 提醒在 13:50

  it('時間到了就送出通知，而且只送一次', async () => {
    const store = memoryStore(at('2026-11-10', '13:49'));
    const deliver = vi.fn();
    const p = new LocalProvider({ store, deliver, onMissed: vi.fn() });
    await p.sync(ctx(t, at('2026-11-10', '13:50')));
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0]).toMatchObject({ title: '對稿', kind: 'lead' });
    await p.sync(ctx(t, at('2026-11-10', '13:51')));
    await p.sync(ctx(t, at('2026-11-10', '13:52')));
    expect(deliver).toHaveBeenCalledTimes(1); // 不會重複
  });

  it('還沒到時間不送；之後完成了就不送', async () => {
    const store = memoryStore(at('2026-11-10', '13:00'));
    const deliver = vi.fn();
    const p = new LocalProvider({ store, deliver, onMissed: vi.fn() });
    await p.sync(ctx(t, at('2026-11-10', '13:40')));
    expect(deliver).not.toHaveBeenCalled();
    await p.sync(ctx([{ ...t[0], done: true }], at('2026-11-10', '13:55')));
    expect(deliver).not.toHaveBeenCalled();
  });

  it('改時間後，用新時間重新提醒', async () => {
    const store = memoryStore(at('2026-11-10', '13:00'));
    const deliver = vi.fn();
    const p = new LocalProvider({ store, deliver, onMissed: vi.fn() });
    await p.sync(ctx([{ ...t[0], time: '15:00' }], at('2026-11-10', '13:55'))); // 已改成 15:00 → 14:50 才響
    expect(deliver).not.toHaveBeenCalled();
    await p.sync(ctx([{ ...t[0], time: '15:00' }], at('2026-11-10', '14:50')));
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('很久之前就該響的（上次看到之後）→ 算錯過，不跳通知', async () => {
    const store = memoryStore(at('2026-11-10', '13:00'));
    const deliver = vi.fn();
    const onMissed = vi.fn();
    const p = new LocalProvider({ store, deliver, onMissed });
    await p.sync(ctx(t, at('2026-11-10', '16:00')));
    expect(deliver).not.toHaveBeenCalled();
    expect(onMissed).toHaveBeenCalledTimes(1);
    expect(onMissed.mock.calls[0][0].map((r: Reminder) => r.title)).toEqual(['對稿']);
    await p.sync(ctx(t, at('2026-11-10', '16:01')));
    expect(onMissed).toHaveBeenCalledTimes(1); // 不會再報一次
  });

  it('第一次使用（沒有「最後看到的時間」）不會一次跳出一堆舊提醒', async () => {
    const store = memoryStore(undefined);
    const onMissed = vi.fn();
    const p = new LocalProvider({ store, deliver: vi.fn(), onMissed });
    await p.sync(ctx(t, at('2026-11-10', '16:00')));
    expect(onMissed).not.toHaveBeenCalled();
    expect(store.lastSeen).toBe(at('2026-11-10', '16:00'));
  });

  it('通知沒開（notificationsEnabled = false）就是「沒設定」', () => {
    const p = new LocalProvider({ store: memoryStore(), deliver: vi.fn(), onMissed: vi.fn() });
    expect(p.isConfigured(S({ notificationsEnabled: false }))).toBe(false);
    expect(p.isConfigured(S())).toBe(true);
  });
});

describe('drainDue（打開 App 時）', () => {
  it('allMissed：全部算錯過（連兩分鐘內的也是）', async () => {
    const store = memoryStore(at('2026-11-10', '13:00'));
    const t = [task({ id: 'a', time: '14:00' })];
    const { live, missed } = await drainDue(ctx(t, at('2026-11-10', '13:51')), store, true);
    expect(live).toEqual([]);
    expect(missed).toHaveLength(1);
  });

  it('最多往回看 3 天', async () => {
    const store = memoryStore(at('2026-10-01', '00:00'));
    const t = [task({ id: 'old', date: '2026-10-05', time: '10:00' }), task({ id: 'recent', date: '2026-11-09', time: '10:00' })];
    const { missed } = await drainDue(ctx(t, at('2026-11-10', '12:00')), store, true);
    expect(missed.filter((r) => r.kind === 'lead').map((r) => r.title)).toEqual(['recent']);
  });
});

describe('PushProvider（推播，設定留空時要自動略過）', () => {
  const t = [task({ id: 'a', time: '14:00', date: '2026-11-11' })];
  const now = at('2026-11-10', '12:00');
  const fakeSub = { toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } }) };
  const mkDeps = (over: Partial<PushDeps> = {}) => {
    const subscribe = vi.fn(async () => fakeSub);
    const getSubscription = vi.fn(async () => null);
    const deps: PushDeps = {
      getRegistration: vi.fn(async () => ({ pushManager: { subscribe, getSubscription } as unknown as PushManager })),
      permission: () => 'granted',
      fetch: vi.fn(async () => ({ ok: true, status: 200 }) as Response),
      ...over,
    };
    return { deps, subscribe, getSubscription };
  };

  it('預設設定是空的 → 不算「已設定」', () => {
    expect(isPushConfigured(DEFAULT_SETTINGS)).toBe(false);
    expect(isPushConfigured({ ...DEFAULT_SETTINGS, push: { endpoint: 'https://x', vapidPublicKey: '', secret: 's' } })).toBe(false);
    expect(isPushConfigured({ ...DEFAULT_SETTINGS, push: { endpoint: '', vapidPublicKey: 'abc', secret: 's' } })).toBe(false);
    expect(isPushConfigured({ ...DEFAULT_SETTINGS, push: { endpoint: 'https://x', vapidPublicKey: 'abc', secret: '' } })).toBe(false);
    expect(isPushConfigured({ ...DEFAULT_SETTINGS, push: { endpoint: 'https://x', vapidPublicKey: 'abc', secret: 's' } })).toBe(true);
  });

  it('空設定：不取得註冊、不訂閱、不發送，也不丟錯', async () => {
    const { deps, subscribe } = mkDeps();
    const manager = new NotificationManager([new PushProvider(deps)]);
    await expect(manager.sync(ctx(t, now, S()), 'change')).resolves.toBeUndefined();
    expect(deps.getRegistration).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('有設定：訂閱並把排程送到伺服器；資料沒變就不重送', async () => {
    const { deps, subscribe } = mkDeps();
    const p = new PushProvider(deps);
    const settings = S({ push: { endpoint: 'https://server.example/', vapidPublicKey: 'BEl6', secret: 'pw' } });
    await p.sync(ctx(t, now, settings), 'change');
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://server.example/sync');
    expect(init.headers.Authorization).toBe('Bearer pw');
    const body = JSON.parse(init.body);
    expect(body.version).toBe(1);
    expect(body.subscription.endpoint).toBe('https://push.example/abc');
    expect(body.reminders.map((r: { id: string }) => r.id).some((id: string) => id.startsWith('lead:a'))).toBe(true);
    await p.sync(ctx(t, now + 1000, settings), 'change');
    await p.sync(ctx(t, now + 2000, settings), 'tick');
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    // 事項改了 → 重送
    await p.sync(ctx([{ ...t[0], time: '16:00' }], now + 3000, settings), 'change');
    expect(deps.fetch).toHaveBeenCalledTimes(2);
  });

  it('沒有通知權限時不訂閱、不發送', async () => {
    const { deps, subscribe } = mkDeps({ permission: () => 'default' });
    const settings = S({ push: { endpoint: 'https://server.example/', vapidPublicKey: 'BEl6', secret: 'pw' } });
    await new PushProvider(deps).sync(ctx(t, now, settings), 'change');
    expect(subscribe).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('伺服器掛了（網路錯誤或非 2xx）：由 manager 接住，不影響其他提醒', async () => {
    const settings = S({ push: { endpoint: 'https://server.example/', vapidPublicKey: 'BEl6', secret: 'pw' } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = new PushProvider(mkDeps({ fetch: vi.fn(async () => { throw new Error('offline'); }) }).deps);
    const err = new PushProvider(mkDeps({ fetch: vi.fn(async () => ({ ok: false, status: 500 }) as Response) }).deps);
    const other: NotificationProvider = { name: 'local', isConfigured: () => true, sync: vi.fn(async () => {}) };
    const manager = new NotificationManager([bad, err, other]);
    await expect(manager.sync(ctx(t, now, settings), 'change')).resolves.toBeUndefined();
    expect(other.sync).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('測試伺服器：未設定、無權限、密碼錯、成功各有對應訊息，並帶密碼', async () => {
    const settings = S({ push: { endpoint: 'https://server.example', vapidPublicKey: 'BEl6', secret: 'pw' } });
    expect(await testPushServer(DEFAULT_SETTINGS, mkDeps().deps)).toContain('先填好');
    expect(await testPushServer(settings, mkDeps({ permission: () => 'default' }).deps)).toContain('開啟通知');
    const r401 = mkDeps({ fetch: vi.fn(async () => ({ ok: false, status: 401 }) as Response) });
    expect(await testPushServer(settings, r401.deps)).toBe('密碼不正確。');
    const ok = mkDeps();
    expect(await testPushServer(settings, ok.deps)).toContain('已請伺服器發送');
    const [url, init] = (ok.deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://server.example/test');
    expect(init.headers.Authorization).toBe('Bearer pw');
    const down = mkDeps({ fetch: vi.fn(async () => { throw new Error('x'); }) });
    expect(await testPushServer(settings, down.deps)).toContain('連不上');
  });

  it('已經訂閱過就沿用，不重複訂閱', async () => {
    const getSubscription = vi.fn(async () => fakeSub);
    const subscribe = vi.fn();
    const sub = await subscribeToPush({ pushManager: { getSubscription, subscribe } as unknown as PushManager }, 'BEl6');
    expect(sub).toBe(fakeSub);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('VAPID 公鑰 base64url → bytes', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255]); // base64url 的 - 與 _
  });

  it('推播資料格式', () => {
    const r: Reminder = { id: 'x', kind: 'lead', at: 5, date: '2026-11-11', title: 'T', body: 'B' };
    expect(buildPushPayload([r], { endpoint: 'e' }, 9)).toEqual({
      version: 1, generatedAt: 9, subscription: { endpoint: 'e' },
      reminders: [{ id: 'x', at: 5, title: 'T', body: 'B', date: '2026-11-11', url: './?date=2026-11-11' }],
    });
  });
});

describe('NotificationManager', () => {
  it('沒設定好的略過；一個出錯不影響後面的；同步一次只跑一個', async () => {
    const order: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const skipped: NotificationProvider = { name: 'push', isConfigured: () => false, sync: vi.fn(async () => {}) };
    const broken: NotificationProvider = { name: 'push', isConfigured: () => true, sync: async () => { throw new Error('x'); } };
    const slow: NotificationProvider = {
      name: 'local', isConfigured: () => true,
      sync: async (c) => { order.push('start' + c.now); await new Promise((r) => setTimeout(r, 20)); order.push('end' + c.now); },
    };
    const m = new NotificationManager([skipped, broken, slow]);
    await Promise.all([m.sync(ctx([], 1), 'change'), m.sync(ctx([], 2), 'tick')]);
    expect(skipped.sync).not.toHaveBeenCalled();
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2']);
    warn.mockRestore();
  });
});

describe('設定與發送紀錄的儲存', () => {
  let db: AppDB;
  let n = 0;
  beforeEach(async () => {
    db = new AppDB('notify-' + n++);
    await db.open();
  });

  it('沒存過 → 預設值（早上 08:30、提前 10 分、推播設定空白）', async () => {
    expect(await loadSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('只改一個欄位，其餘保留；推播設定是巢狀的也要合併', async () => {
    await saveSettings(db, { leadMinutes: 30 });
    await saveSettings(db, { morningTime: '09:00' });
    expect(await loadSettings(db)).toMatchObject({ leadMinutes: 30, morningTime: '09:00', notificationsEnabled: false, push: { endpoint: '', vapidPublicKey: '', secret: '' } });
  });

  it('發送紀錄：記下後就查得到；最後看到的時間可存取；舊紀錄 14 天後清掉', async () => {
    const store = createReminderStore(db);
    expect(await store.getLastSeen()).toBeUndefined();
    await store.setLastSeen(123);
    expect(await store.getLastSeen()).toBe(123);
    await store.markFired(['a', 'b'], Date.now());
    expect([...(await store.firedIds(['a', 'b', 'c']))].sort()).toEqual(['a', 'b']);
    await db.firedReminders.put({ id: 'old', firedAt: Date.now() - 15 * 24 * 3600 * 1000 });
    const { purgeExpired } = await import('../db/maintenance');
    await purgeExpired(db);
    expect((await db.firedReminders.toArray()).map((r) => r.id).sort()).toEqual(['a', 'b']);
  });
});

describe('collectBootMissed（打開 App 時）', () => {
  let db: AppDB;
  let n = 0;
  beforeEach(async () => {
    db = new AppDB('boot-' + n++);
    await db.open();
  });

  it('通知沒開 → 什麼都不找、不動資料', async () => {
    const { collectBootMissed } = await import('./boot');
    await db.tasks.add(task({ id: 'a', time: '14:00' }));
    expect(await collectBootMissed(db, S({ notificationsEnabled: false }), at('2026-11-10', '16:00'))).toEqual([]);
    expect(await createReminderStore(db).getLastSeen()).toBeUndefined();
  });

  it('上次關閉後該響的 → 列為錯過，記成已發送，且只列一次', async () => {
    const { collectBootMissed } = await import('./boot');
    const store = createReminderStore(db);
    await store.setLastSeen(at('2026-11-10', '13:00'));
    await db.tasks.add(task({ id: 'a', title: '對稿', time: '14:00' }));
    const first = await collectBootMissed(db, S(), at('2026-11-10', '16:00'));
    expect(first.map((r) => r.title)).toContain('對稿');
    expect(await collectBootMissed(db, S(), at('2026-11-10', '16:01'))).toEqual([]);
    expect(await store.getLastSeen()).toBe(at('2026-11-10', '16:01'));
  });

  it('在自動延到今天「之前」呼叫：昨天沒做完的事項，昨天的提醒還找得到', async () => {
    const { collectBootMissed } = await import('./boot');
    const { rolloverDb } = await import('../db/maintenance');
    await createReminderStore(db).setLastSeen(at('2026-11-09', '09:00'));
    await db.tasks.add(task({ id: 'y', title: '昨天的事', date: '2026-11-09', time: '10:00' }));
    const missed = await collectBootMissed(db, S(), at('2026-11-10', '09:00'));
    expect(missed.filter((r) => r.kind === 'lead').map((r) => r.title)).toEqual(['昨天的事']);
    await rolloverDb(db, '2026-11-10');
    expect((await db.tasks.get('y'))!.date).toBe('2026-11-10');
  });
});
