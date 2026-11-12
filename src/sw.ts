import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { isISODate, notificationTarget, parsePushMessage } from './lib/swLogic';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> };

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// 背景推播：伺服器送來時跳通知（伺服器還沒設定時，這段不會被觸發）
self.addEventListener('push', (event) => {
  const msg = parsePushMessage(event.data ? event.data.text() : null);
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag,
      data: { date: msg.date },
      icon: new URL('icons/icon-192.png', self.registration.scope).href,
    }),
  );
});

// 點通知：打開 App 並跳到那一天
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const date: unknown = event.notification.data?.date;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        await client.focus();
        if (isISODate(date)) client.postMessage({ type: 'open-date', date });
        return;
      }
      await self.clients.openWindow(notificationTarget(self.registration.scope, date));
    })(),
  );
});
