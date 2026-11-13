import { Sheet } from './Sheet';
import type { RepeatFreq } from '../types';
import { REPEAT_LABEL } from '../lib/repeat';

interface Props {
  heading: string; // 例如「設為重要」「修改重複事項」
  title: string; // 事項標題
  freq: RepeatFreq;
  hint: string;
  closing: boolean;
  onCancel: () => void;
  onOne: () => void;
  onFuture: () => void;
}

/** 重複事項的詢問框：只改這一次還是之後每一次（重要、修改內容共用） */
export function ScopeSheet({ heading, title, freq, hint, closing, onCancel, onOne, onFuture }: Props) {
  return (
    <Sheet closing={closing} onClose={onCancel} labelledBy="scope-title" scrimLabel="關閉">
      <h2 id="scope-title" className="sheet-title">{heading}</h2>
      <p className="del-text">「{title}」是{REPEAT_LABEL[freq]}重複的事項。</p>
      <div className="del-actions">
        <button type="button" className="btn-ghost" onClick={onOne}>僅限這次</button>
        <button type="button" className="btn-ghost" onClick={onFuture}>未來每一次</button>
        <button type="button" className="btn-text" onClick={onCancel}>取消</button>
      </div>
      <p className="field-hint">{hint}</p>
    </Sheet>
  );
}
