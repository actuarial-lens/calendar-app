import { describe, expect, it } from 'vitest';
import type { Reminder } from './reminders';
import { RELOAD_KEY, clearReloadState, mergeMissed, saveReloadState, takeReloadState } from './reloadState';
import { createUpdateReloader } from './updateReload';

function memStore(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as unknown as Storage & { map: Map<string, string> };
}

const rem = (id: string, at: number, extra: Partial<Reminder> = {}): Reminder => ({
  id,
  kind: 'lead',
  at,
  date: '2026-11-20',
  title: id,
  body: '11/20 09:00',
  ...extra,
});

describe('reloadState', () => {
  it('存了再讀：還原清單與日期，並刪掉 key', () => {
    const s = memStore();
    saveReloadState(s, { missed: [rem('a', 1), rem('b', 2)], day: '2026-11-20' });
    expect(s.map.has(RELOAD_KEY)).toBe(true);
    const got = takeReloadState(s);
    expect(got.missed.map((r) => r.id)).toEqual(['a', 'b']);
    expect(got.day).toBe('2026-11-20');
    expect(s.map.has(RELOAD_KEY)).toBe(false);
    expect(takeReloadState(s)).toEqual({ missed: [] });
  });

  it('壞資料不會出錯：格式不對的提醒與日期被丟掉', () => {
    const s = memStore();
    s.setItem(RELOAD_KEY, JSON.stringify({ missed: [rem('ok', 1), { id: 1 }, null, rem('x', 2, { date: 'abc' })], day: 'nope' }));
    const got = takeReloadState(s);
    expect(got.missed.map((r) => r.id)).toEqual(['ok']);
    expect(got.day).toBeUndefined();
    s.setItem(RELOAD_KEY, '{not json');
    expect(takeReloadState(s)).toEqual({ missed: [] });
  });

  it('storage 丟出錯誤也不會出錯', () => {
    const bad = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
      removeItem: () => {
        throw new Error('x');
      },
    };
    expect(() => saveReloadState(bad, { missed: [] })).not.toThrow();
    expect(takeReloadState(bad)).toEqual({ missed: [] });
    expect(() => clearReloadState(bad)).not.toThrow();
  });

  it('clearReloadState 清掉存著的清單', () => {
    const s = memStore();
    saveReloadState(s, { missed: [rem('a', 1)] });
    clearReloadState(s);
    expect(takeReloadState(s).missed).toEqual([]);
  });

  it('mergeMissed：同 id 只留一個、照時間排', () => {
    const merged = mergeMissed([rem('b', 5), rem('c', 9)], [rem('a', 1), rem('b', 5)]);
    expect(merged.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(mergeMissed([], [])).toEqual([]);
  });
});

function fakeDoc(initial: 'visible' | 'hidden') {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: initial as string,
    addEventListener: (_t: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_t: string, fn: () => void) => void listeners.delete(fn),
  };
  return { doc, set: (v: string) => { doc.visibilityState = v; listeners.forEach((f) => f()); } };
}

describe('createUpdateReloader', () => {
  it('在前景時不重新整理，離開 App 才存狀態並重新整理一次', () => {
    const { doc, set } = fakeDoc('visible');
    const log: string[] = [];
    const r = createUpdateReloader({ doc, save: () => log.push('save'), reload: () => log.push('reload') });
    r.needReload();
    expect(log).toEqual([]);
    set('visible');
    expect(log).toEqual([]);
    set('hidden');
    expect(log).toEqual(['save', 'reload']);
    set('visible');
    set('hidden');
    expect(log).toEqual(['save', 'reload']); // 只做一次
  });

  it('還沒有新版時，離開 App 什麼都不做', () => {
    const { doc, set } = fakeDoc('visible');
    const log: string[] = [];
    createUpdateReloader({ doc, save: () => log.push('save'), reload: () => log.push('reload') });
    set('hidden');
    expect(log).toEqual([]);
  });

  it('本來就在背景時，有新版就直接重新整理', () => {
    const { doc } = fakeDoc('hidden');
    const log: string[] = [];
    createUpdateReloader({ doc, save: () => log.push('save'), reload: () => log.push('reload') }).needReload();
    expect(log).toEqual(['save', 'reload']);
  });

  it('save 丟出錯誤仍然重新整理', () => {
    const { doc, set } = fakeDoc('visible');
    const log: string[] = [];
    const r = createUpdateReloader({ doc, save: () => { throw new Error('x'); }, reload: () => log.push('reload') });
    r.needReload();
    set('hidden');
    expect(log).toEqual(['reload']);
  });
});
