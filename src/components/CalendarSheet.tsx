import { useEffect, useState } from 'react';
import { WEEKDAYS_MON, monthCells, parseISO } from '../lib/dates';
import { Sheet } from './Sheet';
import type { LoadLevel } from '../lib/sort';

interface Props {
  day: string;
  closing: boolean;
  today: string;
  level?: (iso: string) => LoadLevel; // 這天有多滿（顏色深淺）
  minDate?: string; // 早於這天的日子不能選
  todayLabel?: string;
  onPick: (iso: string) => void;
  onToday: () => void;
  onClose: () => void;
}

const Chevron = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export function CalendarSheet({ day, closing, today, level, minDate, todayLabel = '回到今天', onPick, onToday, onClose }: Props) {
  const [ym, setYm] = useState(() => {
    const d = parseISO(day);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const shift = (n: number) => {
    const d = new Date(ym.y, ym.m + n, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Sheet closing={closing} onClose={onClose} labelledBy="cal-title" scrimLabel="關閉月曆" className="cal-sheet">
        <div className="cal-head">
          <button type="button" className="cal-nav" aria-label="上個月" onClick={() => shift(-1)}>
            <Chevron d="M11 3.5L5.5 9l5.5 5.5" />
          </button>
          <h2 id="cal-title" className="sheet-title">{ym.y}年{ym.m + 1}月</h2>
          <button type="button" className="cal-nav" aria-label="下個月" onClick={() => shift(1)}>
            <Chevron d="M7 3.5L12.5 9 7 14.5" />
          </button>
        </div>
        <div className="cal-week" aria-hidden="true">
          {WEEKDAYS_MON.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="cal-grid">
          {monthCells(ym.y, ym.m).map((iso, i) =>
            iso === null ? (
              <span key={'b' + i} className="cal-blank" />
            ) : (
              <button
                key={iso}
                type="button"
                className={'cal-day' + (iso === today ? ' today' : '') + (level ? ' lv' + level(iso) : '')}
                aria-pressed={iso === day}
                disabled={!!minDate && iso < minDate}
                aria-label={`${ym.m + 1}月${Number(iso.slice(8))}日${iso === today ? '（今天）' : ''}`}
                onClick={() => onPick(iso)}
              >
                <span className="n">{Number(iso.slice(8))}</span>
              </button>
            ),
          )}
        </div>
        <button type="button" className="cal-today" onClick={onToday}>{todayLabel}</button>
    </Sheet>
  );
}
