import { useState } from 'react';
import { alertsLines, monthDay, MONTH_DAY_WIDEST, type Alerts } from '../lib/alerts';
import type { Task } from '../types';

interface Props {
  alerts: Alerts;
  closing: boolean;
  onAck: () => void; // 已確認：今天收起來，明天再出現
  onMoveAll: () => void; // 全部移至本日（呼叫端先跳確認視窗）
  onMute: (t: Task) => void; // 這一筆不再通知
  onComplete: (t: Task) => void; // 截止事項的「已完成」
}

/** 日期欄：用隱藏的最寬日期撐開寬度，讓右邊的事項標題上下對齊 */
function DateCell({ iso }: { iso: string }) {
  return (
    <span className="alerts-date">
      {monthDay(iso)}
      <span className="alerts-date-sizer" aria-hidden="true">{MONTH_DAY_WIDEST}</span>
    </span>
  );
}

/** 畫面上方的提示框：過去的重要未結＋即將截止（深琥珀色） */
export function AlertBox({ alerts, closing, onAck, onMoveAll, onMute, onComplete }: Props) {
  const [open, setOpen] = useState(false);
  const { overdue, deadlines } = alerts;
  const tab = open ? 0 : -1;
  return (
    <section className={'alerts' + (closing ? ' closing' : '')} aria-label="重要未結與截止提示">
      <div className="alerts-head">
        <button type="button" className="alerts-sum" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {alertsLines(alerts).map((l) => (
            <span key={l} className="alerts-line">{l}</span>
          ))}
        </button>
        <button type="button" className="alerts-cap" onClick={onAck}>已確認</button>
      </div>
      <div className={'missed-fold' + (open ? '' : ' folded')} aria-hidden={!open}>
        <div>
          {overdue.length > 0 && (
            <div className="alerts-sec">
              <h3 className="alerts-h-red">未結重要事件</h3>
              <ul>
                {overdue.map((t) => (
                  <li key={t.id}>
                    <DateCell iso={t.date} />
                    <span className="alerts-main"><span className="alerts-title">{t.title}</span></span>
                    <button type="button" className="alerts-cap" tabIndex={tab} onClick={() => onMute(t)}>不再通知</button>
                  </li>
                ))}
              </ul>
              <div className="alerts-actions">
                <button type="button" className="alerts-cap wide" tabIndex={tab} onClick={onMoveAll}>全部移至本日</button>
              </div>
            </div>
          )}
          {deadlines.length > 0 && (
            <div className="alerts-sec">
              <h3>未來 7 天內截止事件</h3>
              <ul>
                {deadlines.map(({ task: t, expired }) => (
                  <li key={t.id}>
                    <DateCell iso={t.date} />
                    <span className="alerts-main">
                      <span className="alerts-title">{t.title}</span>
                      {expired && (
                        <>
                          <span className="alerts-sep">·</span>
                          <span className="alerts-expired">已過期</span>
                        </>
                      )}
                    </span>
                    <button type="button" className="alerts-cap" tabIndex={tab} onClick={() => onComplete(t)}>已完成</button>
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
