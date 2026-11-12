/** crypto.randomUUID 只在 https／localhost 可用；開發時用區網 http 連線會沒有，所以要有備案 */
export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
