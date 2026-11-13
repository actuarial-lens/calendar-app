// Service Worker 裡用到的純邏輯（獨立出來才能測試）

export interface PushMessage {
  title: string;
  body: string;
  date?: string;
  tag?: string;
  id?: string; // 提醒 id（App 用來記錄已發送）
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isISODate = (s: unknown): s is string => typeof s === 'string' && ISO.test(s);

/** 解析伺服器送來的推播內容；格式不對也不能出錯，改顯示預設文字 */
export function parsePushMessage(text: string | null | undefined): PushMessage {
  const fallback: PushMessage = { title: 'Calendar', body: '你有一則提醒' };
  if (!text) return fallback;
  try {
    const d = JSON.parse(text) as Record<string, unknown>;
    return {
      title: typeof d.title === 'string' && d.title ? d.title : fallback.title,
      body: typeof d.body === 'string' ? d.body : '',
      date: isISODate(d.date) ? d.date : undefined,
      tag: typeof d.tag === 'string' ? d.tag : typeof d.id === 'string' ? d.id : undefined,
      id: typeof d.id === 'string' ? d.id : undefined,
    };
  } catch {
    return { ...fallback, body: text.slice(0, 200) };
  }
}

/** 點通知後要打開的網址：App 首頁，帶 ?date= 讓它跳到那一天 */
export function notificationTarget(scope: string, date: unknown): string {
  const url = new URL('./', scope);
  if (isISODate(date)) url.searchParams.set('date', date);
  return url.href;
}

/** App 的資料庫名稱與「已發送提醒」的資料表（和 db/db.ts 一致） */
export const DB_NAME = 'blue-week';
export const FIRED_STORE = 'firedReminders';

/**
 * 推播送到時，把提醒 id 記成「已發送」，打開 App 時就不會再列在「錯過的提醒」。
 * 資料庫還沒建立（從沒開過 App）就什麼都不做，不能在這裡建出一個空的資料庫。
 */
export function recordFired(factory: IDBFactory, id: string | undefined, now: number): Promise<void> {
  if (!id) return Promise.resolve();
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(DB_NAME);
    } catch {
      return resolve();
    }
    req.onupgradeneeded = () => req.transaction?.abort(); // 不存在：放棄，不建立
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
    req.onsuccess = () => {
      const idb = req.result;
      try {
        if (!idb.objectStoreNames.contains(FIRED_STORE)) {
          idb.close();
          return resolve();
        }
        const tx = idb.transaction(FIRED_STORE, 'readwrite');
        tx.objectStore(FIRED_STORE).put({ id, firedAt: now });
        tx.oncomplete = tx.onerror = tx.onabort = () => {
          idb.close();
          resolve();
        };
      } catch {
        idb.close();
        resolve();
      }
    };
  });
}
