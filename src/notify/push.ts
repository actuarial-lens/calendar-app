import { MINUTE, buildReminders, type Reminder } from '../lib/reminders';
import type { Settings } from '../types';
import type { NotificationProvider, SyncContext, SyncReason } from './types';

const DAY = 24 * 60 * MINUTE;
/** 一次送給伺服器幾天份的提醒排程 */
export const PUSH_HORIZON_MS = 7 * DAY;

export interface PushPayload {
  version: 1;
  generatedAt: number;
  subscription: unknown; // PushSubscription.toJSON()
  reminders: { id: string; at: number; title: string; body: string; date: string; url: string }[];
}

/** 空的就代表還沒設定；沒設定時不訂閱、不發送 */
export function isPushConfigured(settings: Settings): boolean {
  return settings.push.endpoint.trim() !== '' && settings.push.vapidPublicKey.trim() !== '';
}

/** 把「接下來的提醒排程」整理成可以送給伺服器的資料 */
export function buildPushPayload(reminders: Reminder[], subscription: unknown, now: number): PushPayload {
  return {
    version: 1,
    generatedAt: now,
    subscription,
    reminders: reminders.map((r) => ({
      id: r.id,
      at: r.at,
      title: r.title,
      body: r.body,
      date: r.date,
      url: `./?date=${r.date}`,
    })),
  };
}

/** VAPID 公鑰（base64url）→ PushManager.subscribe 要的格式 */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** 用 PushManager 訂閱（已訂閱過就直接回傳原本的） */
export async function subscribeToPush(
  registration: { pushManager: PushManager },
  vapidPublicKey: string,
): Promise<PushSubscription> {
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
}

export interface PushDeps {
  getRegistration(): Promise<{ pushManager: PushManager } | undefined>;
  permission(): NotificationPermission | 'unsupported';
  fetch: typeof fetch;
}

/** 背景推播。設定（伺服器網址、VAPID 公鑰）是空的時候，什麼都不做。 */
export class PushProvider implements NotificationProvider {
  readonly name = 'push' as const;
  private lastSent = '';

  constructor(private deps: PushDeps) {}

  isConfigured(settings: Settings): boolean {
    return isPushConfigured(settings);
  }

  async sync(ctx: SyncContext, reason: SyncReason): Promise<void> {
    if (!this.isConfigured(ctx.settings)) return;
    if (reason === 'tick') return; // 資料沒變就不用重送
    if (this.deps.permission() !== 'granted') return;
    const registration = await this.deps.getRegistration();
    if (!registration?.pushManager) return;

    const subscription = await subscribeToPush(registration, ctx.settings.push.vapidPublicKey);
    const reminders = buildReminders(ctx.tasks, ctx.settings, ctx.now, ctx.now + PUSH_HORIZON_MS);
    const payload = buildPushPayload(reminders, subscription.toJSON(), ctx.now);

    const fingerprint = JSON.stringify([payload.subscription, payload.reminders]);
    if (fingerprint === this.lastSent) return;
    const res = await this.deps.fetch(ctx.settings.push.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`推播伺服器回應 ${res.status}`);
    this.lastSent = fingerprint;
  }
}

export const browserPushDeps = (): PushDeps => ({
  getRegistration: async () => (await navigator.serviceWorker?.getRegistration()) ?? undefined,
  permission: () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission),
  fetch: (...args) => fetch(...args),
});
