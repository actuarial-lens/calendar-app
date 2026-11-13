// 2026-11-13 審查報告修正：第 3、5、10 項
import 'fake-indexeddb/auto';
import { IDBFactory as FakeFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { AppDB } from '../db/db';
import { collectBootMissed } from './boot';
import { createReminderStore } from '../db/settings';
import { atLocal, lateLeadReminders } from '../lib/reminders';
import { parsePushMessage, recordFired } from '../lib/swLogic';
import { DEFAULT_SETTINGS, type Settings, type Task } from '../types';
import { LocalProvider, type ReminderStore } from './local';
import { NotificationManager } from './manager';
import { PushProvider, type PushDeps } from './push';

const at = (d: string, hm: string) => atLocal(d, hm)!;
const S = (p: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, notificationsEnabled: true, leadMinutes: 30, ...p });
const task = (p: Partial<Task> & { id: string }): Task => ({
  date: '2026-11-10', time: '10:20', category: '會議', title: p.id, note: '',
  done: false, delayDays: 0, createdAt: 1, updatedAt: 1, ...p,
});
function memoryStore(lastSeen?: number): ReminderStore & { fired: Set<string> } {
  const st = {
    fired: new Set<string>(), lastSeen,
    firedIds: async (ids: string[]) => new Set(ids.filter((i) => st.fired.has(i))),
    markFired: async (ids: string[]) => ids.forEach((i) => st.fired.add(i)),
    getLastSeen: async () => st.lastSeen,
    setLastSeen: async (ts: number) => { st.lastSeen = ts; },
  };
  return st;
}

describe('第 3 項：來不及的提前提醒要馬上提醒一次', () => {
  it('10:00 新增 10:20 的事（提前 30 分）：馬上提醒，而且只一次', async () => {
    const now = at('2026-11-10', '10:00');
    const store = memoryStore(now - 15_000);
    const deliver = vi.fn();
    const p = new LocalProvider({ store, deliver, onMissed: vi.fn() });
    await p.sync({ tasks: [task({ id: 'a' })], settings: S(), now });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0]).toMatchObject({ title: 'a', at: now });
    await p.sync({ tasks: [task({ id: 'a' })], settings: S(), now: now + 15_000 });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('把預設提前從 5 分改成 30 分：原本 10:15 的提醒不會消失', async () => {
    const now = at('2026-11-10', '10:00');
    const store = memoryStore(now - 15_000);
    const deliver = vi.fn();
    const p = new LocalProvider({ store, deliver, onMissed: vi.fn() });
    await p.sync({ tasks: [task({ id: 'a' })], settings: S({ leadMinutes: 5 }), now });
    expect(deliver).not.toHaveBeenCalled();
    await p.sync({ tasks: [task({ id: 'a' })], settings: S({ leadMinutes: 30 }), now: now + 1000 });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('事項已經開始、已完成、已刪除、沒指定時間：不提醒', () => {
    const now = at('2026-11-10', '10:30');
    const from = now - 15_000;
    expect(lateLeadReminders([task({ id: 'a' })], S(), from, now)).toEqual([]); // 10:20 已過
    const later = at('2026-11-10', '10:00');
    expect(lateLeadReminders([task({ id: 'b', done: true }), task({ id: 'c', deletedAt: 1 }), task({ id: 'd', time: '上午' })], S(), later - 1, later)).toEqual([]);
  });

  it('正常時間到的提醒不會被算兩次', () => {
    const now = at('2026-11-10', '09:50'); // 剛好到提醒時間
    expect(lateLeadReminders([task({ id: 'a' })], S(), now - 15_000, now)).toEqual([]);
  });
});

describe('第 5 項：推播送到的提醒不再列在「錯過的提醒」', () => {
  it('推播內容帶 id', () => {
    expect(parsePushMessage(JSON.stringify({ title: 't', id: 'lead:a' })).id).toBe('lead:a');
  });

  it('Service Worker 記下 id 後，打開 App 不列為錯過', async () => {
    const db = new AppDB('fix5-' + Math.random());
    await db.open();
    const t = task({ id: 'a', time: '14:00' });
    await db.tasks.put(t);
    const reminderAt = at('2026-11-10', '13:30');
    await createReminderStore(db).setLastSeen(reminderAt - 60_000); // App 在提醒前關掉
    const id = `lead:a:2026-11-10:14:00:30`;
    await recordFired(indexedDB, undefined, 1); // 沒 id 不會出錯
    await recordFiredIn(db.name, id);
    const missed = await collectBootMissed(db, S(), at('2026-11-10', '13:45'));
    expect(missed.map((r) => r.id)).not.toContain(id);
    db.close();
  });

  it('沒被推播送到的，照樣列為錯過', async () => {
    const db = new AppDB('fix5b-' + Math.random());
    await db.open();
    await db.tasks.put(task({ id: 'a', time: '14:00' }));
    await createReminderStore(db).setLastSeen(at('2026-11-10', '13:00'));
    const missed = await collectBootMissed(db, S(), at('2026-11-10', '13:45'));
    expect(missed.map((r) => r.id)).toEqual(['lead:a:2026-11-10:14:00:30']);
    db.close();
  });

  it('資料庫還不存在時不會建立空的資料庫', async () => {
    const factory = new FakeFactory();
    await recordFired(factory, 'x', 1);
    const names = await factory.databases();
    expect(names).toEqual([]);
  });
});

/** recordFired 寫的是固定名稱的資料庫；測試時換成指定名稱 */
async function recordFiredIn(name: string, id: string) {
  const factory = {
    open: () => indexedDB.open(name),
  } as unknown as IDBFactory;
  await recordFired(factory, id, Date.now());
}

describe('第 10 項：推播欄位清空時請伺服器停止', () => {
  const configured = S({ push: { endpoint: 'https://srv.example/', vapidPublicKey: 'BAAA', secret: 'pw' } });
  const sub = { toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } }) };
  const mk = () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    const deps: PushDeps = {
      getRegistration: async () => ({ pushManager: { subscribe: async () => sub, getSubscription: async () => sub } as unknown as PushManager }),
      permission: () => 'granted',
      fetch,
    };
    return { fetch, manager: new NotificationManager([new PushProvider(deps)]) };
  };
  const tasks = [task({ id: 'a', date: '2026-11-11' })];
  const now = at('2026-11-10', '12:00');

  it('清空後呼叫 /unsubscribe 一次；重新填好會再送 /sync', async () => {
    const { fetch, manager } = mk();
    await manager.sync({ tasks, settings: configured, now }, 'change');
    await manager.sync({ tasks, settings: { ...configured, push: { ...configured.push, secret: '' } }, now }, 'change');
    await manager.sync({ tasks, settings: { ...configured, push: { ...configured.push, secret: '' } }, now }, 'change');
    await manager.sync({ tasks, settings: configured, now }, 'change');
    const paths = fetch.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(paths).toEqual(['https://srv.example/sync', 'https://srv.example/unsubscribe', 'https://srv.example/sync']);
    expect((fetch.mock.calls[1] as unknown[])[1]).toMatchObject({ headers: { Authorization: 'Bearer pw' } });
  });

  it('從沒送過就不會呼叫 /unsubscribe', async () => {
    const { fetch, manager } = mk();
    await manager.sync({ tasks, settings: S(), now }, 'change');
    expect(fetch).not.toHaveBeenCalled();
  });
});
