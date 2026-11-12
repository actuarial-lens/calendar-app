// Service Worker 裡用到的純邏輯（獨立出來才能測試）

export interface PushMessage {
  title: string;
  body: string;
  date?: string;
  tag?: string;
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
