import type { AppDB } from '../db/db';
import { createReminderStore, saveSettings } from '../db/settings';
import { todayISO } from '../lib/dates';
import { notificationPermission, showNativeNotification } from './native';

/**
 * 「開啟通知」按鈕：要求權限（一定要由使用者點按鈕觸發），成功就把通知功能打開。
 * 回傳要顯示給使用者的說明。
 */
export async function enableNotifications(db: AppDB): Promise<string> {
  if (typeof Notification === 'undefined') {
    return '這個瀏覽器不支援通知。請先用 Safari「分享 → 加入主畫面」，再從主畫面圖示打開。';
  }
  const result = await Notification.requestPermission();
  if (result !== 'granted') {
    return '沒有取得通知權限。可以到 iPhone「設定 → 通知 → Calendar」開啟。';
  }
  // 從現在開始算，不要把開啟之前的事項當成「錯過的提醒」
  await createReminderStore(db).setLastSeen(Date.now());
  await saveSettings(db, { notificationsEnabled: true });
  return '通知已開啟。';
}

export async function sendTestNotification(): Promise<string> {
  if (notificationPermission() !== 'granted') return '請先按「開啟通知」。';
  const ok = await showNativeNotification({
    id: 'test:' + Date.now(),
    title: '測試通知',
    body: '看到這則通知，代表通知功能正常。',
    date: todayISO(),
  });
  return ok ? '已發送，請看通知中心。' : '發送失敗，請稍後再試。';
}
