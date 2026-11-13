import { useRef, useState } from 'react';
import { WEEKDAYS_MON, weekDates } from '../lib/dates';
import type { LoadLevel } from '../lib/sort';

interface Props {
  day: string;
  level: (iso: string) => LoadLevel; // 這天有多滿（顏色深淺）
  onPick: (iso: string) => void;
  onShiftWeek: (dir: 1 | -1) => void; // 左右滑動換週：1 = 下一週，-1 = 上一週
}

/** 滑動超過這個距離（px）放開，就換到另一週 */
const SWIPE_DISTANCE = 50;

export function WeekStrip({ day, level, onPick, onShiftWeek }: Props) {
  const dates = weekDates(day);
  const start = dates[0];

  // 換週時，新的一週從滑動的方向滑進來（第一次顯示不做動畫）
  const prevStart = useRef(start);
  const dirRef = useRef<1 | -1 | 0>(0);
  if (prevStart.current !== start) {
    dirRef.current = start > prevStart.current ? 1 : -1;
    prevStart.current = start;
  }

  const g = useRef<{ x0: number; y0: number; axis: 'x' | 'y' | null } | null>(null);
  const swiped = useRef(false); // 這次手勢是滑動的話，放開後的 click 不要當成點選日期
  const dxRef = useRef(0);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const finish = (cancelled: boolean) => {
    const cur = g.current;
    g.current = null;
    if (!cur || cur.axis !== 'x') return;
    setDragging(false);
    const d = dxRef.current;
    dxRef.current = 0;
    setDx(0);
    if (!cancelled && Math.abs(d) >= SWIPE_DISTANCE) onShiftWeek(d < 0 ? 1 : -1);
  };

  return (
    <div
      key={start}
      className={'week' + (dirRef.current === 1 ? ' from-right' : dirRef.current === -1 ? ' from-left' : '')}
      role="group"
      aria-label="選擇日期（左右滑動換週）"
      style={{ transform: dx ? `translateX(${dx * 0.45}px)` : undefined, transition: dragging ? 'none' : 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)' }}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        g.current = { x0: e.clientX, y0: e.clientY, axis: null };
        swiped.current = false;
        dxRef.current = 0;
      }}
      onPointerMove={(e) => {
        const cur = g.current;
        if (!cur) return;
        const mx = e.clientX - cur.x0;
        const my = e.clientY - cur.y0;
        if (!cur.axis) {
          if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
          cur.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
          if (cur.axis === 'x') {
            swiped.current = true;
            setDragging(true);
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* 不支援就算了 */
            }
          }
        }
        if (cur.axis === 'x') {
          dxRef.current = mx;
          setDx(mx);
        }
      }}
      onPointerUp={() => finish(false)}
      onPointerCancel={() => finish(true)}
      onClickCapture={(e) => {
        if (swiped.current) {
          swiped.current = false;
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      {dates.map((iso, i) => (
        <button
          key={iso}
          type="button"
          className={'day lv' + level(iso)}
          aria-pressed={iso === day}
          onClick={() => onPick(iso)}
        >
          <span className="wk">{WEEKDAYS_MON[i]}</span>
          <span className="n">{Number(iso.slice(8))}</span>
        </button>
      ))}
    </div>
  );
}
