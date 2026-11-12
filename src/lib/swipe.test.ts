import { describe, expect, it } from 'vitest';
import { swipeX } from '../components/SwipeRow';

describe('swipeX（手指跟著動的位置）', () => {
  it('沒有右側按鈕時，往右拉不會超過原位（原本的行為）', () => {
    expect(swipeX(0, 50, 192)).toBe(0);
    expect(swipeX(0, -100, 192)).toBe(-100);
  });
  it('有右側按鈕（寬 64）：右滑可以跟著手指，超過按鈕區有阻力且有上限', () => {
    expect(swipeX(0, 40, 192, 64)).toBe(40);
    expect(swipeX(0, 64, 192, 64)).toBe(64);
    const over = swipeX(0, 164, 192, 64);
    expect(over).toBeGreaterThan(64);
    expect(over).toBeLessThanOrEqual(64 + 36);
    expect(swipeX(0, 1000, 192, 64)).toBe(100);
  });
  it('從右滑打開的狀態往左收回', () => {
    expect(swipeX(64, -30, 192, 64)).toBe(34);
    expect(swipeX(64, -100, 192, 64)).toBe(-36);
  });
});
