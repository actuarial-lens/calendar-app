import { Sheet } from './Sheet';

interface Props {
  heading: string;
  text: string;
  confirmLabel: string;
  hint?: string;
  closing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 簡單的確認視窗（例如「全部移至本日」） */
export function ConfirmSheet({ heading, text, confirmLabel, hint, closing, onCancel, onConfirm }: Props) {
  return (
    <Sheet closing={closing} onClose={onCancel} labelledBy="confirm-title" scrimLabel="關閉">
      <h2 id="confirm-title" className="sheet-title">{heading}</h2>
      <p className="del-text">{text}</p>
      <div className="del-actions">
        <button type="button" className="btn-ghost" onClick={onConfirm}>{confirmLabel}</button>
        <button type="button" className="btn-text" onClick={onCancel}>取消</button>
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </Sheet>
  );
}
