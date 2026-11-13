import { describe, expect, it } from 'vitest';
import { SEARCH_LIMIT, highlightParts, noteLine, normalize, parseQuery, searchAll } from './search';
import type { Note, Task } from '../types';

let n = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: 't' + ++n, date: '2026-11-13', time: '', category: '待辦', title: '標題', note: '',
  done: false, delayDays: 0, createdAt: n, updatedAt: n, ...over,
});
const note = (over: Partial<Note> = {}): Note => ({ id: 'n' + ++n, date: '2026-11-13', text: '隨手記', createdAt: n, updatedAt: n, ...over });
const TODAY = '2026-11-13';
const ids = (r: ReturnType<typeof searchAll>) => r.items.map((h) => h.id);

describe('parseQuery／normalize', () => {
  it('空白分詞、小寫、全形轉半形', () => {
    expect(parseQuery('  Hello   ＷＯＲＬＤ ')).toEqual(['hello', 'world']);
    expect(parseQuery('   ')).toEqual([]);
    expect(parseQuery('')).toEqual([]);
    expect(normalize('ＡＢＣ１２３')).toBe('abc123');
  });
});

describe('searchAll：比對', () => {
  it('空字串或只有空白：不搜尋', () => {
    const r = searchAll([task()], [note()], '  ', TODAY);
    expect(r).toEqual({ items: [], total: 0, truncated: false });
  });
  it('比對標題與備註；含已完成', () => {
    const a = task({ id: 'a', title: '與設計組對稿' });
    const b = task({ id: 'b', title: '開會', note: '帶設計稿' });
    const c = task({ id: 'c', title: '設計總結', done: true });
    const d = task({ id: 'd', title: '買菜' });
    const r = searchAll([a, b, c, d], [], '設計', TODAY);
    expect(ids(r).sort()).toEqual(['a', 'b', 'c']);
    expect(r.items.find((h) => h.id === 'c')).toMatchObject({ kind: 'task', done: true });
  });
  it('多個詞：每個詞都要出現（可以分別在標題和備註）', () => {
    const a = task({ id: 'a', title: '開會', note: '三樓會議室' });
    const b = task({ id: 'b', title: '開會', note: '二樓' });
    expect(ids(searchAll([a, b], [], '開會 三樓', TODAY))).toEqual(['a']);
    expect(ids(searchAll([a, b], [], '開會 樓', TODAY)).sort()).toEqual(['a', 'b']);
    expect(ids(searchAll([a, b], [], '開會 四樓', TODAY))).toEqual([]);
  });
  it('大小寫與全形都能找到', () => {
    const a = task({ id: 'a', title: 'Q4 Budget 預算' });
    const b = task({ id: 'b', title: '會議ＡＢＣ' });
    expect(ids(searchAll([a, b], [], 'budget', TODAY))).toEqual(['a']);
    expect(ids(searchAll([a, b], [], 'ＢＵＤＧＥＴ', TODAY))).toEqual(['a']);
    expect(ids(searchAll([a, b], [], 'abc', TODAY))).toEqual(['b']);
    expect(ids(searchAll([a, b], [], 'ＡＢＣ', TODAY))).toEqual(['b']);
    expect(ids(searchAll([a, b], [], 'q4', TODAY))).toEqual(['a']);
  });
  it('隨手記也找得到；已刪除的事項與隨手記不列', () => {
    const t = task({ id: 't1', title: '買牛奶', deletedAt: 5 });
    const live = task({ id: 't2', title: '買牛奶' });
    const nLive = note({ id: 'n1', text: '想買牛奶' });
    const nDead = note({ id: 'n2', text: '牛奶', deletedAt: 5 });
    const r = searchAll([t, live], [nLive, nDead], '牛奶', TODAY);
    expect(ids(r).sort()).toEqual(['n1', 't2']);
    expect(r.items.find((h) => h.id === 'n1')).toMatchObject({ kind: 'note', text: '想買牛奶' });
  });
});

describe('searchAll：排序', () => {
  it('今天以後（近→遠）在前，過去（新→舊）在後；今天算「今天以後」', () => {
    const ts = [
      task({ id: 'past1', date: '2026-11-01', title: 'x' }),
      task({ id: 'past2', date: '2026-11-12', title: 'x' }),
      task({ id: 'far', date: '2026-12-25', title: 'x' }),
      task({ id: 'today', date: TODAY, title: 'x' }),
      task({ id: 'soon', date: '2026-11-14', title: 'x' }),
      task({ id: 'past0', date: '2025-01-01', title: 'x' }),
    ];
    expect(ids(searchAll(ts, [], 'x', TODAY))).toEqual(['today', 'soon', 'far', 'past2', 'past1', 'past0']);
  });
  it('同一天：事項照時間排（compareTasks），隨手記排在事項後面、照建立時間', () => {
    const ts = [
      task({ id: 'late', time: '15:00', title: 'x' }),
      task({ id: 'none', time: '', title: 'x' }),
      task({ id: 'early', time: '09:00', title: 'x' }),
    ];
    const ns = [note({ id: 'n2', text: 'x', createdAt: 200 }), note({ id: 'n1', text: 'x', createdAt: 100 })];
    expect(ids(searchAll(ts, ns, 'x', TODAY))).toEqual(['none', 'early', 'late', 'n1', 'n2']);
  });
  it('過去的同一天也是事項在前、隨手記在後', () => {
    const t = task({ id: 't', date: '2026-11-10', title: 'x' });
    const nn = note({ id: 'n', date: '2026-11-10', text: 'x' });
    const later = task({ id: 'u', date: '2026-11-11', title: 'x' });
    expect(ids(searchAll([t, later], [nn], 'x', TODAY))).toEqual(['u', 't', 'n']);
  });
  it('最多 200 筆，超過標示 truncated，total 是全部符合的數量', () => {
    const ts = Array.from({ length: SEARCH_LIMIT + 25 }, (_, i) => task({ id: 'k' + i, title: 'x', date: '2026-12-01' }));
    const r = searchAll(ts, [], 'x', TODAY);
    expect(r.items).toHaveLength(SEARCH_LIMIT);
    expect(r.total).toBe(SEARCH_LIMIT + 25);
    expect(r.truncated).toBe(true);
    const exact = searchAll(ts.slice(0, SEARCH_LIMIT), [], 'x', TODAY);
    expect(exact.truncated).toBe(false);
  });
});

describe('highlightParts', () => {
  const j = (p: { text: string; hit: boolean }[]) => p.map((x) => (x.hit ? `[${x.text}]` : x.text)).join('');
  it('標出符合的字、忽略大小寫與全形', () => {
    expect(j(highlightParts('與設計組對稿', ['設計']))).toBe('與[設計]組對稿');
    expect(j(highlightParts('Q4 Budget', ['budget']))).toBe('Q4 [Budget]');
    expect(j(highlightParts('會議ＡＢＣ測試', ['abc']))).toBe('會議[ＡＢＣ]測試');
  });
  it('多個詞、重疊、重複出現', () => {
    expect(j(highlightParts('開會開會室', ['開會', '會室']))).toBe('[開會開會室]');
    expect(j(highlightParts('abab', ['ab']))).toBe('[abab]');
    expect(j(highlightParts('a b a', ['a']))).toBe('[a] b [a]');
  });
  it('沒有符合、沒有詞：整段不標；全部符合：整段標', () => {
    expect(highlightParts('文字', ['x'])).toEqual([{ text: '文字', hit: false }]);
    expect(highlightParts('文字', [])).toEqual([{ text: '文字', hit: false }]);
    expect(highlightParts('文字', ['文字'])).toEqual([{ text: '文字', hit: true }]);
    expect(highlightParts('', ['x'])).toEqual([]);
  });
  it('正規化後會變長的字也不會錯位', () => {
    expect(j(highlightParts('㈱ABC', ['abc']))).toBe('㈱[ABC]');
    expect(j(highlightParts('ﬁx', ['fi']))).toBe('[ﬁ]x');
  });
});

describe('noteLine', () => {
  it('換行換成空白、去頭尾', () => {
    expect(noteLine('三樓\n帶筆電\n\n  自備水壺 ')).toBe('三樓 帶筆電 自備水壺');
  });
});
