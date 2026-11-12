import { Sheet } from './Sheet';
import type { Task } from '../types';
import { REPEAT_LABEL } from '../lib/repeat';

interface Props {
  task: Task;
  closing: boolean;
  onCancel: () => void;
  onOne: () => void;
  onAll: () => void;
}

/** 刪除重複事項時，問要刪這一次還是全部 */
export function RepeatDeleteSheet({ task, closing, onCancel, onOne, onAll }: Props) {
  return (
    <Sheet closing={closing} onClose={onCancel} labelledBy="del-title" scrimLabel="關閉">
      <h2 id="del-title" className="sheet-title">刪除重複事項</h2>
      <p className="del-text">
        「{task.title}」是{task.repeat ? REPEAT_LABEL[task.repeat.freq] : ''}重複的事項。
      </p>
      <div className="del-actions">
        <button type="button" className="btn-ghost" onClick={onOne}>只刪這一次</button>
        <button type="button" className="btn-danger" onClick={onAll}>刪除所有重複</button>
        <button type="button" className="btn-text" onClick={onCancel}>取消</button>
      </div>
      <p className="field-hint">「刪除所有重複」會拿掉還沒完成的每一筆，已完成的會留著當紀錄。</p>
    </Sheet>
  );
}
