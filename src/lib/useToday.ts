import { useEffect, useState } from 'react';
import { todayISO } from './dates';

/** 今天的日期。App 回到前景、或跨過午夜時會更新。 */
export function useToday(): string {
  const [today, setToday] = useState(() => todayISO());
  useEffect(() => {
    const check = () => setToday((prev) => {
      const t = todayISO();
      return t === prev ? prev : t;
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);

    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const n = new Date();
      const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 1);
      timer = setTimeout(() => {
        check();
        schedule();
      }, next.getTime() - n.getTime());
    };
    schedule();

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
      clearTimeout(timer);
    };
  }, []);
  return today;
}
