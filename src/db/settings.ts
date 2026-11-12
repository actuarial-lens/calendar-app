import { DEFAULT_SETTINGS, type Settings } from '../types';
import type { AppDB } from './db';
import type { ReminderStore } from '../notify/local';

const KEY = 'settings';

export async function loadSettings(db: AppDB): Promise<Settings> {
  const row = await db.kv.get(KEY);
  const saved = (row?.value ?? {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...saved, push: { ...DEFAULT_SETTINGS.push, ...(saved.push ?? {}) } };
}

export async function saveSettings(db: AppDB, patch: Partial<Settings>): Promise<Settings> {
  return db.transaction('rw', db.kv, async () => {
    const next = { ...(await loadSettings(db)), ...patch };
    await db.kv.put({ key: KEY, value: next });
    return next;
  });
}

/** 「已發送的提醒」與「最後看到的時間」存在本機資料庫 */
export function createReminderStore(db: AppDB): ReminderStore {
  return {
    async firedIds(ids) {
      const rows = await db.firedReminders.bulkGet(ids);
      return new Set(rows.filter((r): r is NonNullable<typeof r> => !!r).map((r) => r.id));
    },
    async markFired(ids, now) {
      await db.firedReminders.bulkPut(ids.map((id) => ({ id, firedAt: now })));
    },
    async getLastSeen() {
      const row = await db.kv.get('lastSeenAt');
      return typeof row?.value === 'number' ? row.value : undefined;
    },
    async setLastSeen(ts) {
      await db.kv.put({ key: 'lastSeenAt', value: ts });
    },
  };
}
