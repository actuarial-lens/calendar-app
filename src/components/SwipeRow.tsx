import { useRef, useState, type ReactNode } from 'react';

export interface SwipeAction {
  label: string;
  color: string;
  run: () => void;
}

interface Props {
  id: string;
  open: boolean;
  anyOpen: boolean; // 目前有沒有任何一列是打開的
  actions: SwipeAction[];
  /** 由左向右滑才會出現的按鈕（沒有就不能往右滑） */
  startActions?: SwipeAction[];
  /** 右滑打開的狀態，目前有哪一列的 key 是 id + START_SUFFIX */
  startOpen?: boolean;
  onOpenChange: (id: string | null) => void;
  onTap?: () => void;
  wrapClass: string;
  frontClass: string;
  children: ReactNode;
}

const BTN_W = 64;
/** 右滑打開時，回報給外面的 key（id 後面加這個符號） */
export const START_SUFFIX = '>';
/** 拉過按鈕區之後的阻力（越小越難拉）與最多能多拉的距離 */
const OVERPULL_RESISTANCE = 0.35;
const OVERPULL_MAX = 36;

/** 手指跟著動的位置：左滑超過按鈕區之後要有阻力，往右不能超過原位 */
export function swipeX(base: number, dx: number, W: number, Ws = 0): number {
  const raw = base + dx;
  if (raw > 0) {
    if (Ws === 0) return 0;
    if (raw <= Ws) return raw;
    return Math.min(Ws + OVERPULL_MAX, Ws + (raw - Ws) * OVERPULL_RESISTANCE);
  }
  if (raw === 0) return 0;
  if (raw >= -W) return raw;
  return Math.max(-W - OVERPULL_MAX, -W + (raw + W) * OVERPULL_RESISTANCE);
}

/**
 * 左滑列。先判斷手勢方向（水平或垂直）才決定要不要跟著手指動，
 * 所以垂直捲動不會誤觸左滑。往左滑超過按鈕區一半才停在打開狀態。
 */
export function SwipeRow({ id, open, anyOpen, actions, startActions = [], startOpen = false, onOpenChange, onTap, wrapClass, frontClass, children }: Props) {
  const W = actions.length * BTN_W;
  const Ws = startActions.length * BTN_W;
  const gesture = useRef<{ x0: number; y0: number; base: number; axis: 'x' | 'y' | null } | null>(null);
  const dxRef = useRef(0);
  const wasOpenRef = useRef(false); // 按下去的當下，有沒有任何一列是打開的
  const swipedRef = useRef(false); // 這次手勢是不是水平滑動（是的話放開後的 click 要忽略）
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [pressed, setPressed] = useState(false); // 手指按著、還沒判斷成滑動時，給一點按下的回饋

  const base = open ? -W : startOpen ? Ws : 0;
  const x = dragging ? swipeX(base, dx, W, Ws) : base;

  const finish = () => {
    const g = gesture.current;
    gesture.current = null;
    setPressed(false);
    if (g?.axis === 'x') {
      const final = g.base + dxRef.current;
      setDragging(false);
      setDx(0);
      dxRef.current = 0;
      if (final < -W / 2) onOpenChange(id);
      else if (Ws > 0 && final > Ws / 2) onOpenChange(id + START_SUFFIX);
      else onOpenChange(null);
    }
  };

  // 點一下要等瀏覽器送出 click 再處理：如果在放開手指時就打開面板，
  // 接著的 click 會落在面板的遮罩上，面板馬上又被關掉。
  const onClick = () => {
    if (swipedRef.current) {
      swipedRef.current = false;
      return;
    }
    // 有打開的列時，點一下只負責收合；沒有才進入編輯
    if (wasOpenRef.current) onOpenChange(null);
    else onTap?.();
  };

  return (
    <div className={wrapClass} data-swipe-id={id}>
      {startActions.length > 0 && (
        <div className="swipe-actions start">
          {startActions.map((a) => (
            <button key={a.label} type="button" tabIndex={startOpen ? 0 : -1} style={{ background: a.color }} onClick={a.run}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      <div className="swipe-actions">
        {actions.map((a) => (
          <button key={a.label} type="button" tabIndex={open ? 0 : -1} style={{ background: a.color }} onClick={a.run}>
            {a.label}
          </button>
        ))}
      </div>
      <div
        className={frontClass + (pressed ? ' pressed' : '')}
        style={{
          transform: `translateX(${x}px)`,
          transition: (dragging ? 'none' : 'transform 0.34s cubic-bezier(0.22, 1, 0.36, 1)') + ', background-color 0.15s ease',
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          gesture.current = { x0: e.clientX, y0: e.clientY, base, axis: null };
          wasOpenRef.current = anyOpen;
          swipedRef.current = false;
          dxRef.current = 0;
          setPressed(true);
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g) return;
          const mx = e.clientX - g.x0;
          const my = e.clientY - g.y0;
          if (!g.axis) {
            if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
            g.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
            setPressed(false);
            if (g.axis === 'x') {
              swipedRef.current = true;
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* 不支援就算了 */
              }
              setDragging(true);
            }
          }
          if (g.axis === 'x') {
            dxRef.current = mx;
            setDx(mx);
          }
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onClick={onClick}
      >
        {children}
      </div>
    </div>
  );
}
