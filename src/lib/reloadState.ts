import type { Reminder } from './reminders';
import { isISODate } from './swLogic';

/** 新版 Service Worker 接手、頁面要重新整理時，暫存在 sessionStorage 的畫面狀態 */
export const RELOAD_KEY = 'reloadState';

export interface ReloadState {
  missed: Reminder[]; // 目前顯示的「錯過的提醒」
  day?: string; // 目前看的日期
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function validReminder(r: unknown): r is Reminder {
  if (!r || typeof r !== 'object') return false;
  const x = r as Record<string, unknown>;
  return (
    typeof x.id === 'string' &&
    (x.kind === 'lead' || x.kind === 'morning') &&
    typeof x.at === 'number' &&
    isISODate(x.date) &&
    typeof x.title === 'string' &&
    typeof x.body === 'string'
  );
}

/** 重新整理前存起來；存不了（空間滿、無痕模式）就算了 */
export function saveReloadState(store: Store, state: ReloadState): void {
  try {
    store.setItem(RELOAD_KEY, JSON.stringify({ missed: state.missed, day: state.day }));
  } catch {
    /* ignore */
  }
}

/** 開機時讀回來並刪掉這個 key；沒有或格式不對就回空的 */
export function takeReloadState(store: Store): ReloadState {
  let raw: string | null = null;
  try {
    raw = store.getItem(RELOAD_KEY);
    store.removeItem(RELOAD_KEY);
  } catch {
    return { missed: [] };
  }
  if (!raw) return { missed: [] };
  try {
    const d = JSON.parse(raw) as { missed?: unknown; day?: unknown };
    return {
      missed: Array.isArray(d.missed) ? d.missed.filter(validReminder) : [],
      day: isISODate(d.day) ? d.day : undefined,
    };
  } catch {
    return { missed: [] };
  }
}

/** 使用者按「錯過的提醒 → 關閉」：存著的清單也清掉 */
export function clearReloadState(store: Store): void {
  try {
    store.removeItem(RELOAD_KEY);
  } catch {
    /* ignore */
  }
}

/** 開機時找到的與重新整理前存的合併（同一個 id 只留一個），照時間排 */
export function mergeMissed(boot: Reminder[], saved: Reminder[]): Reminder[] {
  const seen = new Set<string>();
  const out: Reminder[] = [];
  for (const r of [...saved, ...boot]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out.sort((a, b) => a.at - b.at);
}

// App 把「目前的畫面狀態」放在這裡，main.tsx 的重新整理函式才拿得到
let snapshot: ReloadState = { missed: [] };
export const setReloadSnapshot = (s: ReloadState): void => {
  snapshot = s;
};
export const getReloadSnapshot = (): ReloadState => snapshot;
