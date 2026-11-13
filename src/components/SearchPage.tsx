import { useEffect, useMemo, useRef, useState } from 'react';
import { dayLabel } from '../lib/dates';
import { REPEAT_LABEL } from '../lib/repeat';
import { SEARCH_LIMIT, highlightParts, noteLine, parseQuery, searchAll, type SearchHit } from '../lib/search';
import type { Note, Task } from '../types';

interface Props {
  tasks: Task[];
  notes: Note[];
  today: string;
  closing: boolean;
  onPick: (hit: SearchHit) => void;
  onClose: () => void;
}

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightParts(text, terms).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

/** 搜尋頁：整頁由右滑入；找事項（標題＋備註）與隨手記 */
export function SearchPage({ tasks, notes, today, closing, onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const terms = useMemo(() => parseQuery(query), [query]);
  const result = useMemo(() => searchAll(tasks, notes, query, today), [tasks, notes, query, today]);

  useEffect(() => {
    inputRef.current?.focus(); // 掛上後立刻聚焦（iPhone 要在點放大鏡的同一個事件裡掛上才會跳鍵盤）
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={'search-page' + (closing ? ' closing' : '')} role="dialog" aria-modal="true" aria-label="搜尋">
      <header className="search-head">
        <button type="button" className="back" onClick={onClose} aria-label="返回">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 3.5L5.5 9l5.5 5.5" />
          </svg>
        </button>
        <input
          ref={inputRef}
          autoFocus
          id="search-input"
          type="search"
          className="text-input search-input"
          placeholder="搜尋事項、備註、隨手記"
          aria-label="搜尋關鍵字"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </header>

      <div className="search-body">
        {terms.length === 0 ? (
          <p className="search-empty">輸入關鍵字，搜尋事項與隨手記</p>
        ) : result.items.length === 0 ? (
          <p className="search-empty">找不到符合的內容</p>
        ) : (
          <ul className="search-list">
            {result.items.map((h) => {
              const marks =
                h.kind === 'note'
                  ? ['隨手記']
                  : [...(h.done ? ['已完成'] : []), ...(h.repeat ? [`↻ ${REPEAT_LABEL[h.repeat.freq]}`] : [])];
              return (
                <li key={h.kind + h.id}>
                  <button type="button" className="search-row" data-hit-id={h.id} onClick={() => onPick(h)}>
                    <span className="sr-when">
                      <span className="sr-date">{dayLabel(h.date)}</span>
                      <span className="sr-time">{h.kind === 'task' ? h.time : ''}</span>
                    </span>
                    <span className="sr-main">
                      <span className={'sr-title' + (h.kind === 'task' && h.done ? ' done' : '')}>
                        <Highlighted text={h.kind === 'task' ? h.title : h.text} terms={terms} />
                      </span>
                      {h.kind === 'task' && h.note && (
                        <span className="sr-note">
                          <Highlighted text={noteLine(h.note)} terms={terms} />
                        </span>
                      )}
                      {marks.length > 0 && <span className="sr-marks">{marks.join(' · ')}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {result.truncated && <p className="search-more">只顯示前 {SEARCH_LIMIT} 筆</p>}
      </div>
    </div>
  );
}
