import { describe, expect, it } from 'vitest';
import { mergeEntries, nextExpiry, type Entry } from './animatedList';

const it_ = (id: string) => ({ id });
const phases = (e: Entry<{ id: string }>[]) => e.map((x) => `${x.item.id}:${x.phase}`);
const MS = 260;

describe('mergeEntries（事項增減動畫）', () => {
  it('第一次畫（prev = null）全部直接顯示，沒有動畫', () => {
    expect(phases(mergeEntries(null, [it_('a'), it_('b')], 0, MS))).toEqual(['a:idle', 'b:idle']);
  });

  it('新增的事項 → enter；沒變的維持原狀', () => {
    const first = mergeEntries(null, [it_('a')], 0, MS);
    expect(phases(mergeEntries(first, [it_('a'), it_('b')], 10, MS))).toEqual(['a:idle', 'b:enter']);
  });

  it('清單原本是空的，新增第一筆也有動畫', () => {
    expect(phases(mergeEntries([], [it_('a')], 0, MS))).toEqual(['a:enter']);
  });

  it('消失的事項 → 留在原本的位置 exit，並帶結束時間', () => {
    const first = mergeEntries(null, [it_('a'), it_('b'), it_('c')], 0, MS);
    const next = mergeEntries(first, [it_('a'), it_('c')], 100, MS);
    expect(phases(next)).toEqual(['a:idle', 'b:exit', 'c:idle']);
    expect(next[1].until).toBe(100 + MS);
  });

  it('exit 時間到了就移除；還沒到就繼續保留，且結束時間不會被重算', () => {
    const first = mergeEntries(null, [it_('a'), it_('b')], 0, MS);
    const gone = mergeEntries(first, [it_('a')], 100, MS); // b 在 100 開始 exit，到 360
    const still = mergeEntries(gone, [it_('a')], 200, MS);
    expect(phases(still)).toEqual(['a:idle', 'b:exit']);
    expect(still[1].until).toBe(360);
    expect(phases(mergeEntries(still, [it_('a')], 361, MS))).toEqual(['a:idle']);
  });

  it('exit 途中又回來了（復原）→ 重新 enter', () => {
    const first = mergeEntries(null, [it_('a'), it_('b')], 0, MS);
    const gone = mergeEntries(first, [it_('a')], 100, MS);
    expect(phases(mergeEntries(gone, [it_('a'), it_('b')], 150, MS))).toEqual(['a:idle', 'b:enter']);
  });

  it('同時多筆消失、位置超出範圍也不會出錯', () => {
    const first = mergeEntries(null, [it_('a'), it_('b'), it_('c')], 0, MS);
    expect(phases(mergeEntries(first, [], 10, MS))).toEqual(['a:exit', 'b:exit', 'c:exit']);
    expect(phases(mergeEntries(first, [it_('z')], 10, MS)).sort()).toEqual(['a:exit', 'b:exit', 'c:exit', 'z:enter'].sort());
  });

  it('不改動傳進來的 prev', () => {
    const first = mergeEntries(null, [it_('a'), it_('b')], 0, MS);
    const snapshot = JSON.stringify(first);
    mergeEntries(first, [it_('a')], 5, MS);
    expect(JSON.stringify(first)).toBe(snapshot);
  });
});

describe('nextExpiry', () => {
  it('回傳最早要結束的 exit 時間；沒有 exit 回傳 null', () => {
    const first = mergeEntries(null, [it_('a'), it_('b')], 0, MS);
    expect(nextExpiry(first)).toBeNull();
    const a = mergeEntries(first, [it_('a')], 100, MS);
    expect(nextExpiry(a)).toBe(360);
  });
});
