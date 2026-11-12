import { useEffect, useReducer, useRef } from 'react';

/**
 * 讓「消失」也有動畫：value 變成 null 之後，還會保留最後一個值 ms 毫秒，
 * 期間 closing 為 true（給 CSS 播放離開動畫），時間到才真的拿掉。
 */
export function usePresence<T>(value: T | null, ms = 280): { shown: T | null; closing: boolean } {
  const last = useRef<T | null>(value);
  const [, force] = useReducer((x: number) => x + 1, 0);
  if (value !== null) last.current = value;
  const closing = value === null && last.current !== null;

  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => {
      last.current = null;
      force();
    }, ms);
    return () => clearTimeout(t);
  }, [closing, ms]);

  return { shown: value ?? (closing ? last.current : null), closing };
}
