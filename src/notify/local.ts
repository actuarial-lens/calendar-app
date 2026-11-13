import { LIVE_WINDOW_MS, buildReminders, lateLeadReminders, splitDue, type Reminder } from '../lib/reminders';
import type { NotificationProvider, SyncContext } from './types';

const DAY = 24 * 60 * 60 * 1000;
/** 最多往回看幾天，避免很久沒開 App 時出現一長串 */
const MAX_LOOKBACK = 3 * DAY;

export interface ReminderStore {
  /** 回傳這些 id 中，已經發過的 */
  firedIds(ids: string[]): Promise<Set<string>>;
  markFired(ids: string[], now: number): Promise<void>;
  getLastSeen(): Promise<number | undefined>;
  setLastSeen(ts: number): Promise<void>;
}

/**
 * 找出「上次檢查之後到現在」該響、還沒發過的提醒，標記成已發送，並更新「最後看到的時間」。
 * allMissed：App 剛打開時，全部都算錯過的（不重新跳通知）。
 */
export async function drainDue(
  ctx: SyncContext,
  store: ReminderStore,
  allMissed = false,
): Promise<{ live: Reminder[]; missed: Reminder[] }> {
  const { tasks, settings, now } = ctx;
  const lastSeen = (await store.getLastSeen()) ?? now; // 第一次使用：從現在開始算
  const from = Math.max(lastSeen, now - MAX_LOOKBACK);
  // 還要加上來不及的提前提醒（事項還沒開始就馬上提醒一次）；發過的會被下面的紀錄擋掉
  const candidates = [...buildReminders(tasks, settings, from, now), ...lateLeadReminders(tasks, settings, from, now)];
  const fired = await store.firedIds(candidates.map((r) => r.id));
  const due = candidates.filter((r) => !fired.has(r.id));
  const split = splitDue(due, now, allMissed ? -1 : LIVE_WINDOW_MS);
  if (due.length) await store.markFired(due.map((r) => r.id), now);
  await store.setLastSeen(now);
  return split;
}

export interface LocalDeps {
  store: ReminderStore;
  /** 時間剛到：跳系統通知，並在 App 內顯示 */
  deliver(r: Reminder): void | Promise<void>;
  /** 錯過的提醒：顯示在畫面最上方 */
  onMissed(list: Reminder[]): void;
}

/** App 開著時的本機提醒 */
export class LocalProvider implements NotificationProvider {
  readonly name = 'local' as const;
  constructor(private deps: LocalDeps) {}

  isConfigured(settings: { notificationsEnabled: boolean }): boolean {
    return settings.notificationsEnabled;
  }

  async sync(ctx: SyncContext): Promise<void> {
    const { live, missed } = await drainDue(ctx, this.deps.store);
    if (missed.length) this.deps.onMissed(missed);
    for (const r of live) await this.deps.deliver(r);
  }
}
