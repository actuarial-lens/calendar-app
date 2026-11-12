import type { AppDB } from '../db/db';
import { createReminderStore } from '../db/settings';
import type { Reminder } from '../lib/reminders';
import type { Settings } from '../types';
import { drainDue } from './local';

/**
 * 打開 App 時：找出「上次關閉後該響卻沒發出去」的提醒（全部算錯過）。
 * 一定要在「沒做完自動延到今天」之前呼叫，才看得到它們原本的日期。
 */
export async function collectBootMissed(db: AppDB, settings: Settings, now: number = Date.now()): Promise<Reminder[]> {
  if (!settings.notificationsEnabled) return [];
  const tasks = await db.tasks.toArray();
  const { live, missed } = await drainDue({ tasks, settings, now }, createReminderStore(db), true);
  return [...missed, ...live].sort((a, b) => a.at - b.at);
}
