export function Toast({ text, closing, onUndo }: { text: string; closing: boolean; onUndo: () => void }) {
  return (
    <div className={'toast' + (closing ? ' closing' : '')} role="status">
      <span>{text}</span>
      <button type="button" onClick={onUndo} disabled={closing}>復原</button>
    </div>
  );
}
