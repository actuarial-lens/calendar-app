import { useEffect } from 'react';
import type { Reminder } from '../lib/reminders';

/** 時間到了，App 開著時在畫面上方顯示（系統通知另外跳） */
export function Banner({ reminder, closing, onClose }: { reminder: Reminder; closing: boolean; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 10_000);
    return () => clearTimeout(t);
  }, [reminder.id, onClose]);
  return (
    <div className={'banner' + (closing ? ' closing' : '')} role="alert">
      <div className="banner-text">
        <strong>{reminder.title}</strong>
        <span>{reminder.body}</span>
      </div>
      <button type="button" onClick={onClose} aria-label="關閉提醒">✕</button>
    </div>
  );
}
