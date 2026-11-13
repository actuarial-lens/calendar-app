import type { Note, Task } from '../types';
import { compareTasks } from './sort';

/** 搜尋結果最多列幾筆 */
export const SEARCH_LIMIT = 200;

/** 比對用的正規化：全形英數轉半形（NFKC）、轉小寫 */
export const normalize = (s: string): string => s.normalize('NFKC').toLowerCase();

/** 關鍵字 → 詞（用空白分開、正規化、去掉空的）；沒有任何詞就回空陣列（不搜尋） */
export function parseQuery(q: string): string[] {
  return normalize(q).split(/\s+/).filter(Boolean);
}

export type SearchHit =
  | { kind: 'task'; id: string; date: string; time: string; title: string; note: string; done: boolean; repeat?: Task['repeat'] }
  | { kind: 'note'; id: string; date: string; text: string; createdAt: number };

export interface SearchResult {
  items: SearchHit[];
  total: number; // 符合的總筆數（可能超過 items 的長度）
  truncated: boolean;
}

const EMPTY: SearchResult = { items: [], total: 0, truncated: false };

const allTermsIn = (hay: string, terms: string[]) => terms.every((t) => hay.includes(t));

/**
 * 搜尋未刪除的事項（標題＋備註，含已完成）與未刪除的隨手記；每個詞都要出現才算符合。
 * 排序：今天以後（日期近 → 遠）在前，過去（日期新 → 舊）在後；同一天事項照 compareTasks，隨手記排在事項後面、照建立時間。
 */
export function searchAll(tasks: Task[], notes: Note[], query: string, today: string, limit = SEARCH_LIMIT): SearchResult {
  const terms = parseQuery(query);
  if (terms.length === 0) return EMPTY;

  type Item = { hit: SearchHit; task?: Task; at: number };
  const found: Item[] = [];
  for (const t of tasks) {
    if (t.deletedAt) continue;
    if (!allTermsIn(normalize(t.title + '\n' + t.note), terms)) continue;
    found.push({
      task: t,
      at: 0,
      hit: { kind: 'task', id: t.id, date: t.date, time: t.time, title: t.title, note: t.note, done: t.done, ...(t.repeat ? { repeat: t.repeat } : {}) },
    });
  }
  for (const n of notes) {
    if (n.deletedAt) continue;
    if (!allTermsIn(normalize(n.text), terms)) continue;
    found.push({ at: n.createdAt, hit: { kind: 'note', id: n.id, date: n.date, text: n.text, createdAt: n.createdAt } });
  }

  const upcoming = (x: Item) => x.hit.date >= today;
  found.sort((a, b) => {
    const ua = upcoming(a);
    if (ua !== upcoming(b)) return ua ? -1 : 1;
    if (a.hit.date !== b.hit.date) return (a.hit.date < b.hit.date ? -1 : 1) * (ua ? 1 : -1);
    if (a.task && b.task) return compareTasks(a.task, b.task);
    if (a.task) return -1;
    if (b.task) return 1;
    return a.at - b.at || (a.hit.id < b.hit.id ? -1 : a.hit.id > b.hit.id ? 1 : 0);
  });

  return { items: found.slice(0, limit).map((x) => x.hit), total: found.length, truncated: found.length > limit };
}

export interface Part {
  text: string;
  hit: boolean;
}

/**
 * 把文字切成「符合的字」與其他：和比對一樣忽略大小寫、全形半形。
 * 逐字正規化，才能對回原文的位置（有些字正規化後會變長）。
 */
export function highlightParts(text: string, terms: string[]): Part[] {
  const chars = Array.from(text);
  let norm = '';
  const owner: number[] = []; // 正規化字串的每個位置 → 原文第幾個字
  chars.forEach((c, i) => {
    const n = normalize(c);
    for (let k = 0; k < n.length; k++) owner.push(i);
    norm += n;
  });
  const mark = new Array<boolean>(chars.length).fill(false);
  for (const term of terms) {
    if (!term) continue;
    for (let from = norm.indexOf(term); from !== -1; from = norm.indexOf(term, from + 1)) {
      for (let k = from; k < from + term.length; k++) mark[owner[k]] = true;
    }
  }
  const parts: Part[] = [];
  chars.forEach((c, i) => {
    const last = parts[parts.length - 1];
    if (last && last.hit === mark[i]) last.text += c;
    else parts.push({ text: c, hit: mark[i] });
  });
  return parts;
}

/** 備註的單行預覽：換行換成空白 */
export const noteLine = (note: string): string => note.replace(/\s*\n\s*/g, ' ').trim();
