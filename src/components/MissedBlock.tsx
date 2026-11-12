import { useState } from 'react';
import { dayLabel } from '../lib/dates';
import type { Reminder } from '../lib/reminders';

interface Props {
  items: Reminder[];
  closing: boolean;
  today: string;
  onClose: () => void;
}

/** 今天的事項只顯示時間；其他天的帶上日期；早上提醒列出內容，不是今天的再加註日期 */
function missedBody(r: Reminder, today: string): string {
  if (r.kind === 'lead') return r.date === today ? r.body.replace(/^\S+\s/, '') : r.body;
  return r.date === today ? r.body : `${dayLabel(r.date)} ${r.body}`;
}

/** 畫面最上方的「錯過的提醒」，可以收合或關閉 */
export function MissedBlock({ items, closing, today, onClose }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;
  return (
    <section className={'missed' + (closing ? ' closing' : '')} aria-label="錯過的提醒">
      <div className="missed-head">
        <h2>錯過的提醒 <span className="missed-count">{items.length}</span></h2>
        <button type="button" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
          {collapsed ? '展開' : '收合'}
        </button>
        <button type="button" onClick={onClose}>關閉</button>
      </div>
      <div className={'missed-fold' + (collapsed ? ' folded' : '')} aria-hidden={collapsed}>
        <ul>
          {items.map((r) => (
            <li key={r.id}>
              <span className="missed-title">{r.title}</span>
              <span className="missed-body">{missedBody(r, today)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
