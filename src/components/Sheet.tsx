import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  closing: boolean;
  onClose: () => void;
  labelledBy: string;
  scrimLabel: string;
  className?: string;
  children: ReactNode;
}

/** 往下拖超過這個距離（px）放開，就關閉面板 */
const CLOSE_DRAG = 90;

/** 底部面板：從下面滑上來、遮罩淡入；握把那一條可以往下拖來關閉 */
export function Sheet({ closing, onClose, labelledBy, scrimLabel, className = '', children }: Props) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);
  const dyRef = useRef(0);
  const sheetRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const move = (dy: number) => {
    dyRef.current = dy;
    setDragY(dy);
  };
  const end = (cancelled: boolean) => {
    if (startY.current === null) return;
    startY.current = null;
    setDragging(false);
    if (!cancelled && dyRef.current > CLOSE_DRAG) onCloseRef.current(); // 保留目前的位置，從這裡繼續滑出去
    else move(0);
  };

  // 面板上任何地方（輸入框除外）往下拖都能關閉；內容有捲動時，要先捲到最上面才會接手。
  // 需要 preventDefault 擋掉瀏覽器自己的捲動，所以用非 passive 的原生 touch 事件。
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    let x0 = 0;
    let y0 = 0;
    let mode: 'idle' | 'drag' | 'skip' = 'idle';
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      x0 = t.clientX;
      y0 = t.clientY;
      mode = (e.target as Element).closest('input, textarea, select, .grabber-zone, .wheel') ? 'skip' : 'idle';
    };
    const onMove = (e: TouchEvent) => {
      if (mode === 'skip') return;
      const t = e.touches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      if (mode === 'idle') {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (dy > 0 && dy > Math.abs(dx) && el.scrollTop <= 0) {
          mode = 'drag';
          startY.current = y0;
          setDragging(true);
        } else {
          mode = 'skip';
          return;
        }
      }
      if (e.cancelable) e.preventDefault();
      move(Math.max(0, dy));
    };
    const onEnd = (e: TouchEvent) => {
      if (mode === 'drag') end(e.type === 'touchcancel');
      mode = 'idle';
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return (
    <div className={'overlay' + (closing ? ' closing' : '')}>
      <button
        type="button"
        className="scrim"
        aria-label={scrimLabel}
        onClick={onClose}
        style={{ opacity: Math.max(0, 1 - dragY / 320), transition: dragging ? 'none' : 'opacity 0.3s ease' }}
      />
      <section
        ref={sheetRef}
        className={'sheet ' + className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={{
          transform: closing ? 'translateY(100%)' : `translateY(${dragY}px)`,
          transition: dragging ? 'none' : 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >
        <div
          className="grabber-zone"
          onPointerDown={(e) => {
            startY.current = e.clientY;
            setDragging(true);
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* 不支援就算了 */
            }
          }}
          onPointerMove={(e) => {
            if (startY.current !== null) move(Math.max(0, e.clientY - startY.current));
          }}
          onPointerUp={() => end(false)}
          onPointerCancel={() => end(true)}
        >
          <span className="grabber" aria-hidden="true" />
        </div>
        {children}
      </section>
    </div>
  );
}
