import { Sheet } from './Sheet';
import type { RepeatFreq } from '../types';
import { REPEAT_LABEL } from '../lib/repeat';

interface Props {
  title: string;
  freq: RepeatFreq;
  turnOn: boolean; // true = 要設為重要，false = 要取消重要
  closing: boolean;
  onCancel: () => void;
  onOne: () => void;
  onFuture: () => void;
}

/** 重複事項點「重要」（或取消）的當下，問只改這一次還是之後每一次 */
export function ImportantScopeSheet({ title, freq, turnOn, closing, onCancel, onOne, onFuture }: Props) {
  return (
    <Sheet closing={closing} onClose={onCancel} labelledBy="imp-title" scrimLabel="關閉">
      <h2 id="imp-title" className="sheet-title">{turnOn ? '設為重要' : '取消重要'}</h2>
      <p className="del-text">「{title}」是{REPEAT_LABEL[freq]}重複的事項。</p>
      <div className="del-actions">
        <button type="button" className="btn-ghost" onClick={onOne}>僅限這次</button>
        <button type="button" className="btn-ghost" onClick={onFuture}>未來每一次</button>
        <button type="button" className="btn-text" onClick={onCancel}>取消</button>
      </div>
      <p className="field-hint">「未來每一次」會改這一筆和之後還沒完成的每一筆。按「儲存」後才會生效。</p>
    </Sheet>
  );
}
