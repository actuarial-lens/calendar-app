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
  const { endpoint, vapidPublicKey, secret } = settings.push;
  return endpoint.trim() !== '' && vapidPublicKey.trim() !== '' && secret.trim() !== '';
}

/** 伺服器網址（去掉結尾斜線）＋路徑 */
export function serverUrl(settings: Settings, path: string): string {
  return settings.push.endpoint.trim().replace(/\/+$/, '') + path;
}

const authHeaders = (settings: Settings) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${settings.push.secret.trim()}`,
});

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

    const subscription = await subscribeToPush(registration, ctx.settings.push.vapidPublicKey.trim());
    const reminders = buildReminders(ctx.tasks, ctx.settings, ctx.now, ctx.now + PUSH_HORIZON_MS);
    const payload = buildPushPayload(reminders, subscription.toJSON(), ctx.now);

    const fingerprint = JSON.stringify([payload.subscription, payload.reminders]);
    if (fingerprint === this.lastSent) return;
    const res = await this.deps.fetch(serverUrl(ctx.settings, '/sync'), {
      method: 'POST',
      headers: authHeaders(ctx.settings),
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

/** 請伺服器立刻推一則測試通知給這支手機；回傳要顯示給使用者的訊息 */
export async function testPushServer(settings: Settings, deps: PushDeps = browserPushDeps()): Promise<string> {
  if (!isPushConfigured(settings)) return '請先填好伺服器網址、公鑰與密碼。';
  if (deps.permission() !== 'granted') return '請先按「開啟通知」並允許。';
  const registration = await deps.getRegistration();
  if (!registration?.pushManager) return '這個環境不支援背景推播（請從主畫面開啟）。';
  try {
    const subscription = await subscribeToPush(registration, settings.push.vapidPublicKey.trim());
    const res = await deps.fetch(serverUrl(settings, '/test'), {
      method: 'POST',
      headers: authHeaders(settings),
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    if (res.status === 401) return '密碼不正確。';
    if (res.status === 403) return '伺服器人數已滿。';
    if (!res.ok) return `伺服器回應 ${res.status}，請檢查設定。`;
    return '已請伺服器發送，幾秒內應該會收到通知。';
  } catch {
    return '連不上伺服器，請檢查網址與網路。';
  }
}
