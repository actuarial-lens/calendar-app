import { TAGS, type Tag } from '../types';

export function TagBar({ tag, onPick }: { tag: Tag; onPick: (t: Tag) => void }) {
  return (
    <div className="tags" role="group" aria-label="分類篩選">
      {TAGS.map((t) => (
        <button key={t} type="button" className="tag" aria-pressed={t === tag} onClick={() => onPick(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}
