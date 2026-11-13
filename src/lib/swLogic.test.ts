import { describe, expect, it } from 'vitest';
import { isISODate, notificationTarget, parsePushMessage } from './swLogic';

describe('parsePushMessage', () => {
  it('正常內容', () => {
    expect(parsePushMessage(JSON.stringify({ title: '對稿', body: '11/10（二） 14:00', date: '2026-11-10', id: 'lead:a' }))).toEqual({
      title: '對稿', body: '11/10（二） 14:00', date: '2026-11-10', tag: 'lead:a', id: 'lead:a',
    });
  });
  it('沒有內容或格式不對也不出錯', () => {
    expect(parsePushMessage(null).title).toBe('Calendar');
    expect(parsePushMessage('').body).toBe('你有一則提醒');
    expect(parsePushMessage('純文字').body).toBe('純文字');
    expect(parsePushMessage('{"title":5,"date":"hello"}')).toMatchObject({ title: 'Calendar', date: undefined });
  });
});

describe('notificationTarget', () => {
  it('帶 date 就跳到那一天；沒帶或不合法就只開首頁', () => {
    expect(notificationTarget('https://me.github.io/app/', '2026-11-12')).toBe('https://me.github.io/app/?date=2026-11-12');
    expect(notificationTarget('https://me.github.io/app/', undefined)).toBe('https://me.github.io/app/');
    expect(notificationTarget('https://me.github.io/app/', '<script>')).toBe('https://me.github.io/app/');
  });
  it('isISODate', () => {
    expect(isISODate('2026-11-12')).toBe(true);
    expect(isISODate('2026-1-2')).toBe(false);
    expect(isISODate(20261112)).toBe(false);
  });
});
