import { useEffect, useReducer, useRef } from 'react';

export type Phase = 'idle' | 'enter' | 'exit';

export interface Entry<T> {
  item: T;
  phase: Phase;
  /** exit 狀態維持到什麼時候（ms 時間戳），之後就從畫面移除 */
  until?: number;
}

/**
 * 把「新的清單」和「上一次畫出來的清單」合併，讓增減可以有動畫：
 * - 新出現的 → phase 'enter'（展開）
 * - 不見了的 → 留在原本的位置 phase 'exit'（收合），ms 毫秒後才真正移除
 * - prev 是 null（第一次畫、或換了日期／分類）→ 全部直接 idle，不做動畫
 */
export function mergeEntries<T extends { id: string }>(prev: Entry<T>[] | null, items: T[], now: number, ms: number): Entry<T>[] {
  if (prev === null) return items.map((item) => ({ item, phase: 'idle' as const }));

  const visibleBefore = new Map<string, Entry<T>>();
  for (const e of prev) if (e.phase !== 'exit') visibleBefore.set(e.item.id, e);

  const out: Entry<T>[] = items.map((item) => {
    const old = visibleBefore.get(item.id);
    return { item, phase: old ? old.phase : ('enter' as const) };
  });

  const nowIds = new Set(items.map((i) => i.id));
  prev.forEach((e, index) => {
    if (nowIds.has(e.item.id)) return;
    if (e.phase === 'exit') {
      if ((e.until ?? 0) <= now) return; // 收合完了
      out.splice(Math.min(index, out.length), 0, e);
    } else {
      out.splice(Math.min(index, out.length), 0, { item: e.item, phase: 'exit', until: now + ms });
    }
  });
  return out;
}

/** 最近一個要結束的 exit 時間；沒有 exit 就回傳 null */
export function nextExpiry<T>(entries: Entry<T>[]): number | null {
  let min: number | null = null;
  for (const e of entries) if (e.phase === 'exit' && e.until !== undefined) min = min === null ? e.until : Math.min(min, e.until);
  return min;
}

/**
 * 給畫面用：回傳帶有 phase 的清單。
 * resetKey 一變（換日期、換分類）就不做動畫，直接換成新清單。
 * ready 為 false（資料還在載入）時不做動畫，也不記錄。
 */
export function useAnimatedList<T extends { id: string }>(items: T[], resetKey: string, ready: boolean, ms = 260): Entry<T>[] {
  const store = useRef<{ key: string; entries: Entry<T>[] | null }>({ key: resetKey, entries: null });
  const [, force] = useReducer((x: number) => x + 1, 0);

  const prev = ready && store.current.key === resetKey ? store.current.entries : null;
  const entries = mergeEntries(prev, items, Date.now(), ms);

  useEffect(() => {
    store.current = { key: resetKey, entries: ready ? entries : null };
    const expiry = nextExpiry(entries);
    if (expiry === null) return;
    const t = setTimeout(force, Math.max(0, expiry - Date.now()) + 20);
    return () => clearTimeout(t);
  });

  return entries;
}
