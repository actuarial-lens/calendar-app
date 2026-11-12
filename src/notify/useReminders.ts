import { useEffect, useMemo, useRef } from 'react';
import { db } from '../db/db';
import { createReminderStore } from '../db/settings';
import type { Reminder } from '../lib/reminders';
import type { Settings, Task } from '../types';
import { LocalProvider } from './local';
import { NotificationManager } from './manager';
import { showNativeNotification } from './native';
import { PushProvider, browserPushDeps } from './push';

const TICK_MS = 15_000;

interface Options {
  tasks: Task[] | undefined;
  settings: Settings | undefined;
  onLive: (r: Reminder) => void;
  onMissed: (list: Reminder[]) => void;
}

/**
 * 接上通知：事項或設定有變、回到前景、每隔一小段時間，都會請兩種通知實作各自同步一次。
 * 提醒是從目前的事項算出來的，所以改時間、延後、完成、刪除之後會自動重算。
 */
export function useReminders({ tasks, settings, onLive, onMissed }: Options) {
  const handlers = useRef({ onLive, onMissed });
  handlers.current = { onLive, onMissed };

  const { manager, store } = useMemo(() => {
    const store = createReminderStore(db);
    const local = new LocalProvider({
      store,
      deliver: async (r) => {
        await showNativeNotification(r); // 系統通知（沒權限就略過）
        handlers.current.onLive(r); // App 內也顯示
      },
      onMissed: (list) => handlers.current.onMissed(list),
    });
    return { manager: new NotificationManager([local, new PushProvider(browserPushDeps())]), store };
  }, []);

  useEffect(() => {
    if (!tasks || !settings) return;
    const run = (reason: 'change' | 'visible' | 'tick') => manager.sync({ tasks, settings, now: Date.now() }, reason);
    void run('change');
    if (!settings.notificationsEnabled) return;

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void run('tick');
    }, TICK_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void run('visible');
      else void store.setLastSeen(Date.now()); // 離開 App 的時間，回來時用來找「錯過的提醒」
    };
    const onHide = () => void store.setLastSeen(Date.now());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
    };
  }, [tasks, settings, manager, store]);
}
