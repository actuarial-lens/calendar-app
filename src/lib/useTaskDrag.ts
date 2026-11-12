import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { dropIndex, neighbors, shiftFor } from './reorder';

interface Drag {
  id: string;
  ids: string[]; // 同一時段、畫面上的順序
  from: number;
  to: number;
  centers: number[];
  pitch: number; // 被拖那張（含間距）的高度
  tops: number[];
  bottoms: number[];
  y0: number;
  dy: number;
  phase: 'drag' | 'drop' | 'settle';
}

const DROP_MS = 200;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * 長按後上下拖動換位置。只能在同一時段內移動（拖到時段的頭尾就停住）。
 * 放開後先把卡片滑到新位置，再寫入；等清單真的換好順序才拿掉位移，畫面不會閃。
 */
export function useTaskDrag(order: string[], onDrop: (id: string, prevId: string | null, nextId: string | null) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const ref = useRef<Drag | null>(null);
  ref.current = drag;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const start = (id: string, groupIds: string[], y: number) => {
    const els = groupIds.map((x) => document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(x)}"]`));
    if (els.some((e) => !e)) return;
    const rects = els.map((e) => e!.getBoundingClientRect());
    const from = groupIds.indexOf(id);
    try {
      navigator.vibrate?.(10);
    } catch {
      /* 不支援就算了 */
    }
    setDrag({
      id, ids: groupIds, from, to: from, y0: y, dy: 0, phase: 'drag',
      centers: rects.map((r) => r.top + r.height / 2),
      tops: rects.map((r) => r.top),
      bottoms: rects.map((r) => r.bottom),
      pitch: rects[from].height,
    });
  };

  const dragging = drag?.phase === 'drag';
  useEffect(() => {
    if (!dragging) return;
    const move = (y: number) => {
      const d = ref.current;
      if (!d || d.phase !== 'drag') return;
      const min = d.tops[0] - d.tops[d.from];
      const max = d.bottoms[d.bottoms.length - 1] - d.bottoms[d.from];
      const dy = Math.min(max, Math.max(min, y - d.y0));
      setDrag({ ...d, dy, to: dropIndex(d.centers, d.from, dy) });
    };
    const onTouch = (e: TouchEvent) => {
      e.preventDefault(); // 拖動時不要捲動畫面
      if (e.touches[0]) move(e.touches[0].clientY);
    };
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') move(e.clientY);
    };
    const end = () => {
      const d = ref.current;
      if (!d || d.phase !== 'drag') return;
      const dy = d.to === d.from ? 0 : d.to > d.from ? d.bottoms[d.to] - d.bottoms[d.from] : d.tops[d.to] - d.tops[d.from];
      ref.current = { ...d, dy, phase: 'drop' }; // touchend 和 pointerup 都會來，只處理一次
      setDrag(ref.current);
      setTimeout(() => {
        if (d.to === d.from) return setDrag(null);
        setDrag((cur) => (cur && cur.id === d.id ? { ...cur, phase: 'settle' } : cur));
        const { prevId, nextId } = neighbors(d.ids, d.from, d.to);
        onDropRef.current(d.id, prevId, nextId);
        setTimeout(() => setDrag((cur) => (cur && cur.id === d.id ? null : cur)), 1000); // 保險
      }, DROP_MS);
    };
    const noMenu = (e: Event) => e.preventDefault();
    window.addEventListener('touchmove', onTouch, { passive: false });
    window.addEventListener('pointermove', onPointer);
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    window.addEventListener('pointerup', end);
    window.addEventListener('contextmenu', noMenu);
    return () => {
      window.removeEventListener('touchmove', onTouch);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('contextmenu', noMenu);
    };
  }, [dragging]);

  // 清單已經換成新順序：拿掉位移（同一次畫面更新，所以不會跳）
  const key = order.join('|');
  useEffect(() => {
    const d = ref.current;
    if (d?.phase !== 'settle') return;
    const now = order.filter((x) => d.ids.includes(x));
    if (now.indexOf(d.id) === d.to) setDrag(null);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 每張卡片的位移樣式 */
  const styleFor = (id: string): CSSProperties | undefined => {
    if (!drag) return undefined;
    const j = drag.ids.indexOf(id);
    if (j < 0) return undefined;
    const anim = drag.phase === 'settle' ? 'none' : `transform ${DROP_MS}ms ${EASE}`;
    if (id === drag.id) {
      return { transform: `translateY(${drag.dy}px)`, transition: drag.phase === 'drag' ? 'none' : anim, position: 'relative', zIndex: 5 };
    }
    return { transform: `translateY(${shiftFor(j, drag.from, drag.to, drag.pitch)}px)`, transition: anim };
  };

  return { start, styleFor, draggingId: drag && drag.phase !== 'settle' ? drag.id : null, active: !!drag };
}
