import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';

/** 訂閱 Dexie 查詢；資料變動時自動更新。載入完成前回傳 undefined。 */
export function useLive<T>(querier: () => Promise<T>): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    const sub = liveQuery(querier).subscribe({ next: setValue, error: (e) => console.error(e) });
    return () => sub.unsubscribe();
    // querier 在呼叫端是固定的查詢，不需要重新訂閱
  }, []);
  return value;
}
