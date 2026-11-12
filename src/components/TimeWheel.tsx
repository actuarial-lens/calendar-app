import { useEffect, useRef } from 'react';
import { fromWheel, minuteOptions, toWheel, type Meridiem } from '../lib/wheel';

const ROW = 40; // 每一列的高度（要跟 CSS 的 --wheel-row 一樣）

interface ColumnProps<T extends string | number> {
  label: string;
  items: { value: T; text: string }[];
  value: T;
  onPick: (v: T) => void;
  flex?: number;
  className?: string;
}

/** 一欄滾輪：上下滑動，停下來時對齊中間那一列 */
function Column<T extends string | number>({ label, items, value, onPick, flex = 1, className = '' }: ColumnProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const index = Math.max(0, items.findIndex((i) => i.value === value));

  // 值是從外面改的（開啟、換成別的事項）時，把滾輪捲到對的位置；自己滑動造成的不用動
  useEffect(() => {
    const el = ref.current;
    if (el && Math.abs(el.scrollTop - index * ROW) > 1) el.scrollTop = index * ROW;
  }, [index]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const settle = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)));
      if (items[i].value !== value) onPick(items[i].value);
    }, 100);
  };

  return (
    <div
      ref={ref}
      className={'wheel-col ' + className}
      style={{ flex }}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onScroll={settle}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const i = Math.min(items.length - 1, Math.max(0, index + d));
        onPick(items[i].value);
      }}
    >
      {items.map((it, i) => (
        <div
          key={String(it.value)}
          role="option"
          aria-selected={i === index}
          className={'wheel-item' + (i === index ? ' on' : '')}
          onClick={() => ref.current?.scrollTo({ top: i * ROW, behavior: 'smooth' })}
        >
          {it.text}
        </div>
      ))}
    </div>
  );
}

const MERIDIEMS: { value: Meridiem; text: string }[] = [
  { value: '上午', text: '上午' },
  { value: '下午', text: '下午' },
];
const HOURS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, text: String(i + 1) }));

interface Props {
  value: string; // 'HH:mm'
  onChange: (hm: string) => void;
}

/** 時間滾輪：上午／下午、時、分（每 5 分鐘一格） */
export function TimeWheel({ value, onChange }: Props) {
  const w = toWheel(value);
  const minutes = minuteOptions(w.minute).map((m) => ({ value: m, text: String(m).padStart(2, '0') }));
  return (
    <div className="wheel" role="group" aria-label="指定時間">
      <div className="wheel-band" aria-hidden="true" />
      <Column label="上午或下午" items={MERIDIEMS} value={w.meridiem} flex={1.1} className="ampm" onPick={(meridiem) => onChange(fromWheel({ ...w, meridiem }))} />
      <Column label="時" items={HOURS} value={w.hour12} onPick={(hour12) => onChange(fromWheel({ ...w, hour12 }))} />
      <Column label="分" items={minutes} value={w.minute} onPick={(minute) => onChange(fromWheel({ ...w, minute }))} />
    </div>
  );
}
