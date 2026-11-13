import { useState } from 'react';
import { alertsSummary, monthDay, type Alerts } from '../lib/alerts';
import type { Task } from '../types';

interface Props {
  alerts: Alerts;
  closing: boolean;
  onAck: () => void; // 已確認：今天收起來，明天再出現
  onMoveAll: () => void; // 全部移至本日（呼叫端先跳確認視窗）
  onMute: () => void; // 不再通知
  onComplete: (t: Task) => void; // 截止事項的「已完成」
}

/** 畫面上方的提示框：過去的重要未結＋即將截止（深琥珀色） */
export function AlertBox({ alerts, closing, onAck, onMoveAll, onMute, onComplete }: Props) {
  const [open, setOpen] = useState(false);
  const { overdue, deadlines } = alerts;
  return (
    <section className={'alerts' + (closing ? ' closing' : '')} aria-label="重要未結與截止提示">
      <div className="alerts-head">
        <button type="button" className="alerts-sum" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {alertsSummary(alerts)}
        </button>
        <button type="button" className="alerts-ack" onClick={onAck}>已確認</button>
      </div>
      <div className={'missed-fold' + (open ? '' : ' folded')} aria-hidden={!open}>
        <div>
          {overdue.length > 0 && (
            <div className="alerts-sec">
              <h3>過去的重要未結</h3>
              <ul>
                {overdue.map((t) => (
                  <li key={t.id}>
                    <span className="alerts-date">{monthDay(t.date)}</span>
                    <span className="alerts-title">{t.title}</span>
                  </li>
                ))}
              </ul>
              <div className="alerts-actions">
                <button type="button" className="alerts-btn" tabIndex={open ? 0 : -1} onClick={onMoveAll}>全部移至本日</button>
                <button type="button" className="alerts-btn" tabIndex={open ? 0 : -1} onClick={onMute}>不再通知</button>
              </div>
            </div>
          )}
          {deadlines.length > 0 && (
            <div className="alerts-sec">
              <h3>截止日</h3>
              <ul>
                {deadlines.map(({ task: t, expired }) => (
                  <li key={t.id}>
                    <span className="alerts-date">{monthDay(t.date)}</span>
                    {expired && <span className="alerts-expired">已過期</span>}
                    <span className="alerts-title">{t.title}</span>
                    <button type="button" className="alerts-done" tabIndex={open ? 0 : -1} onClick={() => onComplete(t)}>已完成</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
