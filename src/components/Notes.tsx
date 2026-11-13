import { useState } from 'react';
import type { Entry } from '../lib/animatedList';
import { formatHM } from '../lib/dates';
import type { Note } from '../types';
import { SwipeRow, type SwipeAction } from './SwipeRow';

interface Props {
  entries: Entry<Note>[];
  resetKey: string; // 換了日期就重新淡入
  openId: string | null;
  actionsFor: (n: Note) => SwipeAction[];
  onOpenChange: (id: string | null) => void;
  onAdd: (text: string) => void;
}

export function Notes({ entries, resetKey, openId, actionsFor, onOpenChange, onAdd }: Props) {
  const [draft, setDraft] = useState('');
  const [shake, setShake] = useState(false);
  const submit = () => {
    const text = draft.trim();
    if (!text) {
      // 空的：按鈕輕晃一下，游標回到輸入框
      setShake(false);
      requestAnimationFrame(() => setShake(true));
      document.getElementById('note')?.focus();
      return;
    }
    onAdd(text);
    setDraft('');
  };
  return (
    <section className="notes" aria-label="隨手記">
      <h2>隨手記</h2>
      <div className="notes-card">
        <div className="fade-in" key={resetKey}>
          {entries.map(({ item: n, phase }) => (
            <div key={n.id} className={'collapse ' + phase} data-note-id={n.id}>
              <div className="collapse-inner">
                <SwipeRow
                  id={n.id}
                  open={openId === n.id}
                  anyOpen={openId !== null}
                  actions={actionsFor(n)}
                  onOpenChange={onOpenChange}
                  wrapClass="note-wrap"
                  frontClass="note-row"
                >
                  <p>{n.text}</p>
                  <span className="at">{formatHM(n.createdAt)}</span>
                </SwipeRow>
              </div>
            </div>
          ))}
        </div>
        <div className="note-input">
          <label htmlFor="note" className="sr-only">寫一則隨手記</label>
          <input
            id="note"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
            }}
            placeholder="想到什麼先記下來"
            enterKeyHint="done"
          />
          <button type="button" className={shake ? 'shake' : undefined} onAnimationEnd={() => setShake(false)} onClick={submit}>記下</button>
        </div>
      </div>
    </section>
  );
}
