import type { Reminder } from '../lib/reminders';

export type PermissionState = NotificationPermission | 'unsupported';

export function notificationPermission(): PermissionState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** 是不是從主畫面圖示打開的（iPhone 要這樣才允許通知） */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** 用 Service Worker 跳系統通知（iPhone 只認這種）；沒有權限就什麼都不做 */
export async function showNativeNotification(r: Pick<Reminder, 'id' | 'title' | 'body' | 'date'>): Promise<boolean> {
  if (notificationPermission() !== 'granted') return false;
  const options: NotificationOptions = {
    body: r.body,
    tag: r.id,
    data: { date: r.date },
    icon: new URL('icons/icon-192.png', document.baseURI).href,
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(r.title, options);
    else new Notification(r.title, options);
    return true;
  } catch (e) {
    console.warn('[通知] 跳通知失敗', e);
    return false;
  }
}
