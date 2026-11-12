import type { Reminder } from '../lib/reminders';
import type { Settings, Task } from '../types';

export interface SyncContext {
  tasks: Task[];
  settings: Settings;
  now: number;
}

/**
 * 什麼時候同步：
 * - change：事項或設定有變（含啟動）
 * - visible：App 回到前景
 * - tick：App 開著時每隔一小段時間檢查一次
 */
export type SyncReason = 'change' | 'visible' | 'tick';

/** 通知有兩種實作：App 開著時的本機提醒（local）、背景推播（push）。 */
export interface NotificationProvider {
  readonly name: 'local' | 'push';
  /** 沒設定好就會被略過，不會出錯 */
  isConfigured(settings: Settings): boolean;
  sync(ctx: SyncContext, reason: SyncReason): Promise<void>;
}

export type { Reminder };
