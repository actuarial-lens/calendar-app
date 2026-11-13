// @ts-nocheck
import { describe, expect, it } from 'vitest';
import worker, { KEEP_DAYS, LATE_MS, MAX_BLOB_CHARS, b64uDecode, b64uEncode, encryptPayload, handleRequest, runDue, userId, validateReminders, vapidAuthorization } from './worker.js';

// ---- RFC 8291 附錄的測試資料（官方範例，輸出必須一個位元組都不差）----
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

const xy = (pub: string) => {
  const raw = b64uDecode(pub);
  return { x: b64uEncode(raw.slice(1, 33)), y: b64uEncode(raw.slice(33, 65)) };
};
async function keyPairFrom(pub: string, priv: string) {
  const { x, y } = xy(pub);
  const alg = { name: 'ECDH', namedCurve: 'P-256' };
  return {
    privateKey: await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x, y, d: priv }, alg, false, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x, y }, alg, true, []),
  };
}

describe('Web Push 加密（RFC 8291）', () => {
  it('官方測試資料：加密結果完全相同', async () => {
    const body = await encryptPayload(RFC.plaintext, { p256dh: RFC.uaPublic, auth: RFC.auth }, {
      asKeyPair: await keyPairFrom(RFC.asPublic, RFC.asPrivate),
      salt: b64uDecode(RFC.salt),
    });
    expect(b64uEncode(body)).toBe(RFC.body);
  });

  it('用接收方的私鑰可以解開（隨機金鑰也行）', async () => {
    const body = await encryptPayload('你好，提醒', { p256dh: RFC.uaPublic, auth: RFC.auth });
    // 接收方：照 RFC 8291 反向解密
    const salt = body.slice(0, 16);
    const idlen = body[20];
    const asPublic = body.slice(21, 21 + idlen);
    const cipher = body.slice(21 + idlen);
    const ua = await keyPairFrom(RFC.uaPublic, RFC.uaPrivate);
    const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
    const te = new TextEncoder();
    const hk = async (s, ikm, info, n) =>
      new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
    const uaPub = b64uDecode(RFC.uaPublic);
    const info = new Uint8Array([...te.encode('WebPush: info\0'), ...uaPub, ...asPublic]);
    const ikm = await hk(b64uDecode(RFC.auth), ecdh, info, 32);
    const cek = await hk(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hk(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), cipher));
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe('你好，提醒');
    expect(plain.at(-1)).toBe(2);
  });
});

// ---- 測試用的環境 ----
async function makeEnv(extra = {}) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = new Uint8Array([4, ...b64uDecode(jwk.x), ...b64uDecode(jwk.y)]);
  const store = new Map();
  const PUSH_KV = {
    get: async (k, type) => (store.has(k) ? (type === 'json' ? JSON.parse(store.get(k)) : store.get(k)) : null),
    put: async (k, v) => void store.set(k, v),
    delete: async (k) => void store.delete(k),
  };
  return { env: { PUSH_KV, VAPID_PUBLIC: b64uEncode(pub), VAPID_PRIVATE: jwk.d, VAPID_SUBJECT: 'mailto:me@example.com', APP_SECRET: 'secret-123', ...extra }, store, verifyKey: pair.publicKey };
}

const SUB = { endpoint: 'https://push.example.com/send/abc', keys: { p256dh: RFC.uaPublic, auth: RFC.auth } };
const post = (path, body, secret = 'secret-123') =>
  new Request('https://worker.example.com' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const NOW = 1_800_000_000_000;
const rem = (id, at, over = {}) => ({ id, at, title: '會議', body: '10 分鐘後', date: '2026-11-12', url: './', ...over });

describe('VAPID', () => {
  it('標頭裡的簽章可以用公鑰驗證，aud 是推播服務的網域', async () => {
    const { env, verifyKey } = await makeEnv();
    const h = await vapidAuthorization(SUB.endpoint, env, 1_700_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
    expect(m).toBeTruthy();
    const [, head, claims, sig, k] = m;
    expect(k).toBe(env.VAPID_PUBLIC);
    expect(JSON.parse(atob(claims.replace(/-/g, '+').replace(/_/g, '/')))).toMatchObject({ aud: 'https://push.example.com', exp: 1_700_000_000 + 43200, sub: 'mailto:me@example.com' });
    expect(b64uDecode(sig)).toHaveLength(64);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, b64uDecode(sig), new TextEncoder().encode(`${head}.${claims}`));
    expect(ok).toBe(true);
  });
});

describe('伺服器：同步排程', () => {
  it('沒有密碼或密碼錯誤：拒絕，不存任何東西', async () => {
    const { env, store } = await makeEnv();
    expect((await handleRequest(post('/sync', { version: 1, subscription: SUB, reminders: [] }, 'wrong'), env, NOW)).status).toBe(401);
    expect(store.size).toBe(0);
    const noHeader = new Request('https://w.example.com/sync', { method: 'POST', body: '{}' });
    expect((await handleRequest(noHeader, env, NOW)).status).toBe(401);
  });
  it('正常同步：存下訂閱與排程；過久之前的提醒不存', async () => {
    const { env, store } = await makeEnv();
    const res = await handleRequest(post('/sync', { version: 1, subscription: SUB, reminders: [rem('a', NOW + 60000), rem('old', NOW - LATE_MS - 1)] }), env, NOW);
    expect(res.status).toBe(200);
    const id = await userId(SUB.endpoint);
    expect(JSON.parse(store.get('index'))).toEqual([id]);
    expect(JSON.parse(store.get('u:' + id)).reminders.map((r) => r.id)).toEqual(['a']);
  });
  it('每個人（每支手機）分開存，互不覆蓋', async () => {
    const { env, store } = await makeEnv();
    const sub2 = { ...SUB, endpoint: 'https://push.example.com/send/xyz' };
    await handleRequest(post('/sync', { version: 1, subscription: SUB, reminders: [rem('a', NOW + 1000)] }), env, NOW);
    await handleRequest(post('/sync', { version: 1, subscription: sub2, reminders: [rem('b', NOW + 1000)] }), env, NOW);
    await handleRequest(post('/sync', { version: 1, subscription: SUB, reminders: [rem('c', NOW + 1000)] }), env, NOW);
    expect(JSON.parse(store.get('index'))).toHaveLength(2);
    expect(JSON.parse(store.get('u:' + (await userId(sub2.endpoint)))).reminders.map((r) => r.id)).toEqual(['b']);
    expect(JSON.parse(store.get('u:' + (await userId(SUB.endpoint)))).reminders.map((r) => r.id)).toEqual(['c']);
  });
  it('人數超過上限：新的人被拒絕，已有的人照常', async () => {
    const { env } = await makeEnv({ MAX_USERS: '1' });
    await handleRequest(post('/sync', { version: 1, subscription: SUB, reminders: [] }), env, NOW);
    const other = { ...SUB, endpoint: 'https://push.example.com/send/other' };
    expect((await handleRequest(post('/sync', { version: 1, subscription: other, reminders: [] }), env, NOW)).status).toBe(403);
    expect((await handleRequest(post('/sync', { version: 1, subscription: SUB, reminders: [] }), env, NOW)).status).toBe(200);
  });
  it('格式不對一律 400：訂閱不是 https、金鑰長度不對、提醒欄位不對', async () => {
    const { env, store } = await makeEnv();
    const bad = [
      { version: 1, subscription: { ...SUB, endpoint: 'http://insecure' }, reminders: [] },
      { version: 1, subscription: { endpoint: SUB.endpoint, keys: { p256dh: 'AAAA', auth: RFC.auth } }, reminders: [] },
      { version: 1, subscription: SUB, reminders: [{ id: 1 }] },
      { version: 1, subscription: SUB, reminders: 'x' },
      { version: 2, subscription: SUB, reminders: [] },
    ];
    for (const b of bad) expect((await handleRequest(post('/sync', b), env, NOW)).status).toBe(400);
    expect(store.size).toBe(0);
    expect(validateReminders(Array.from({ length: 501 }, (_, i) => rem('x' + i, 1)))).toBeNull();
  });
  it('取消訂閱：資料全部清掉', async () => {
    const { env, store } = await makeEnv();
    await handleRequest(post('/sync', { version: 1, subscription: SUB, reminders: [rem('a', NOW + 1000)] }), env, NOW);
    await handleRequest(post('/unsubscribe', { subscription: SUB }), env, NOW);
    expect([...store.keys()].filter((k) => k !== 'index')).toEqual([]);
    expect(JSON.parse(store.get('index'))).toEqual([]);
  });
  it('跨網域呼叫（CORS）：預檢要得到允許，只允許設定的網址', async () => {
    const { env } = await makeEnv({ ALLOWED_ORIGIN: 'https://me.github.io' });
    const res = await handleRequest(new Request('https://w.example.com/sync', { method: 'OPTIONS' }), env, NOW);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://me.github.io');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });
});

describe('伺服器：到點推播', () => {
  const okFetch = () => {
    const calls = [];
    const fn = async (url, init) => (calls.push({ url, init }), { status: 201 });
    return { fn, calls };
  };
  async function setup(reminders, extra) {
    const t = await makeEnv(extra);
    await handleRequest(post('/sync', { version: 1, subscription: SUB, reminders }), t.env, NOW - 120000);
    return t;
  }

  it('到點的送出一次，下一分鐘不會重送；還沒到的不送', async () => {
    const { env } = await setup([rem('due', NOW - 1000), rem('later', NOW + 600000)]);
    const f = okFetch();
    expect(await runDue(env, NOW, f.fn)).toMatchObject({ sent: 1, failed: 0 });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe(SUB.endpoint);
    expect(f.calls[0].init.headers['Content-Encoding']).toBe('aes128gcm');
    expect(f.calls[0].init.headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    expect(f.calls[0].init.body).toBeInstanceOf(Uint8Array);
    expect((await runDue(env, NOW + 60000, f.fn)).sent).toBe(0);
    expect(f.calls).toHaveLength(1);
  });
  it('晚太久（超過 30 分鐘）的不補送', async () => {
    const { env } = await setup([rem('stale', NOW - LATE_MS - 5000)]);
    const f = okFetch();
    // 同步時 NOW-120000 還在保留範圍內，所以這筆是存著的
    expect((await runDue(env, NOW, f.fn)).sent).toBe(0);
    expect(f.calls).toHaveLength(0);
  });
  it('推播服務暫時失敗：下一分鐘再試；成功後就不再送', async () => {
    const { env } = await setup([rem('x', NOW - 1000)]);
    let n = 0;
    const flaky = async () => ({ status: ++n === 1 ? 503 : 201 });
    expect(await runDue(env, NOW, flaky)).toMatchObject({ sent: 0, failed: 1 });
    expect(await runDue(env, NOW + 60000, flaky)).toMatchObject({ sent: 1 });
    expect(await runDue(env, NOW + 120000, flaky)).toMatchObject({ sent: 0 });
  });
  it('手機取消了訂閱（410）：這個人的資料整個移除', async () => {
    const { env, store } = await setup([rem('x', NOW - 1000)]);
    expect(await runDue(env, NOW, async () => ({ status: 410 }))).toMatchObject({ removed: 1 });
    expect(JSON.parse(store.get('index'))).toEqual([]);
    expect([...store.keys()].some((k) => k.startsWith('u:'))).toBe(false);
  });
  it('一支手機出錯不會影響其他人', async () => {
    const t = await makeEnv();
    const sub2 = { ...SUB, endpoint: 'https://push.example.com/send/two' };
    await handleRequest(post('/sync', { version: 1, subscription: SUB, reminders: [rem('a', NOW - 1000)] }), t.env, NOW - 60000);
    await handleRequest(post('/sync', { version: 1, subscription: sub2, reminders: [rem('b', NOW - 1000)] }), t.env, NOW - 60000);
    const urls = [];
    const fn = async (url) => (urls.push(url), url.endsWith('abc') ? Promise.reject(new Error('network')) : { status: 201 });
    expect(await runDue(t.env, NOW, fn)).toMatchObject({ sent: 1, failed: 1 });
    expect(urls).toHaveLength(2);
  });
  it('修改提醒（id 不同）會再送一次；已送出紀錄會清掉不再存在的 id', async () => {
    const { env, store } = await setup([rem('r1', NOW - 1000)]);
    const f = okFetch();
    await runDue(env, NOW, f.fn);
    const uid = await userId(SUB.endpoint);
    expect(JSON.parse(store.get('s:' + uid))).toEqual(['r1']);
    await handleRequest(post('/sync', { version: 1, subscription: SUB, reminders: [rem('r1-changed', NOW + 30000)] }), env, NOW + 1000);
    await runDue(env, NOW + 60000, f.fn);
    expect(f.calls).toHaveLength(2);
    expect(JSON.parse(store.get('s:' + uid))).toEqual(['r1-changed']);
  });
  it('/test：立刻推一則測試', async () => {
    const { env } = await makeEnv();
    const f = okFetch();
    const res = await handleRequest(post('/test', { subscription: SUB }), env, NOW, f.fn);
    expect(res.status).toBe(200);
    expect(f.calls).toHaveLength(1);
    const bad = await handleRequest(post('/test', { subscription: SUB }), env, NOW, async () => ({ status: 403 }));
    expect(bad.status).toBe(502);
  });
  it('預設匯出有 fetch 與 scheduled', () => {
    expect(typeof worker.fetch).toBe('function');
    expect(typeof worker.scheduled).toBe('function');
  });
});


// ---- 雲端備份（D1）----
// 用記憶體做的假 D1：只支援 worker 實際用到的那幾句 SQL（同樣的句子已另外用真正的 SQLite 驗證過）
function fakeD1() {
  const rows: { id: string; day: string; blob: string; size: number; updated_at: number }[] = [];
  const log: string[] = [];
  const db = {
    rows,
    log,
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          args = a;
          return stmt;
        },
        async run() {
          log.push(q.split(' ').slice(0, 3).join(' '));
          if (q.startsWith('CREATE TABLE IF NOT EXISTS backups')) return { success: true };
          if (q.startsWith('INSERT INTO backups') && q.includes('ON CONFLICT(id, day) DO UPDATE')) {
            const [id, day, blob, size, at] = args as [string, string, string, number, number];
            const cur = rows.find((r) => r.id === id && r.day === day);
            if (cur) Object.assign(cur, { blob, size, updated_at: at });
            else rows.push({ id, day, blob, size, updated_at: at });
            return { success: true };
          }
          const keep = /^DELETE FROM backups WHERE id = \?1 AND day NOT IN \(SELECT day FROM backups WHERE id = \?1 ORDER BY day DESC LIMIT (\d+)\)$/.exec(q);
          if (keep) {
            const [id] = args as [string];
            const newest = rows.filter((r) => r.id === id).map((r) => r.day).sort().reverse().slice(0, Number(keep[1]));
            for (let i = rows.length - 1; i >= 0; i--) if (rows[i].id === id && !newest.includes(rows[i].day)) rows.splice(i, 1);
            return { success: true };
          }
          if (q === 'DELETE FROM backups WHERE id = ?1') {
            const [id] = args as [string];
            for (let i = rows.length - 1; i >= 0; i--) if (rows[i].id === id) rows.splice(i, 1);
            return { success: true };
          }
          throw new Error('fake D1: 不支援的 SQL：' + q);
        },
        async all() {
          if (q === 'SELECT day, updated_at, size FROM backups WHERE id = ?1 ORDER BY day DESC') {
            const [id] = args as [string];
            return { results: rows.filter((r) => r.id === id).sort((a, b) => (a.day < b.day ? 1 : -1)).map(({ day, updated_at, size }) => ({ day, updated_at, size })) };
          }
          throw new Error('fake D1: 不支援的 SQL：' + q);
        },
        async first() {
          if (q === 'SELECT blob FROM backups WHERE id = ?1 AND day = ?2') {
            const [id, day] = args as [string, string];
            const r = rows.find((x) => x.id === id && x.day === day);
            return r ? { blob: r.blob } : null;
          }
          if (q === 'SELECT 1 AS x FROM backups WHERE id = ?1 LIMIT 1') {
            const [id] = args as [string];
            return rows.some((r) => r.id === id) ? { x: 1 } : null;
          }
          if (q === 'SELECT COUNT(DISTINCT id) AS n FROM backups') return { n: new Set(rows.map((r) => r.id)).size };
          throw new Error('fake D1: 不支援的 SQL：' + q);
        },
      };
      return stmt;
    },
  };
  return db;
}

const BID = 'a'.repeat(64);
const BID2 = 'b'.repeat(64);
const bput = (id: string, day: string, blob: string, secret?: string) => post('/backup/put', { id, day, blob }, secret);
const json = async (res: Response) => res.json();

describe('伺服器：雲端備份', () => {
  async function setup(extra = {}) {
    const t = await makeEnv(extra);
    const d1 = fakeD1();
    t.env.BACKUP_DB = d1;
    return { ...t, d1 };
  }

  it('沒有綁定 D1：所有備份路徑回 501 no-db，推播路徑照常', async () => {
    const { env } = await makeEnv();
    for (const path of ['/backup/put', '/backup/list', '/backup/get', '/backup/delete']) {
      const res = await handleRequest(post(path, { id: BID, day: '2026-11-13', blob: 'abc' }), env, NOW);
      expect(res.status).toBe(501);
      expect(await json(res)).toEqual({ error: 'no-db' });
    }
    expect((await handleRequest(post('/sync', { version: 1, subscription: SUB, reminders: [] }), env, NOW)).status).toBe(200);
  });

  it('密碼不對：401，什麼都不存（連資料表都不建）', async () => {
    const { env, d1 } = await setup();
    expect((await handleRequest(bput(BID, '2026-11-13', 'abc', 'wrong'), env, NOW)).status).toBe(401);
    expect(d1.rows).toHaveLength(0);
    expect(d1.log).toEqual([]);
  });

  it('上傳 → 列出 → 讀取 → 刪除', async () => {
    const { env, d1 } = await setup();
    expect((await handleRequest(bput(BID, '2026-11-13', 'AAAA-bbbb_01'), env, NOW)).status).toBe(200);
    expect(d1.log[0]).toBe('CREATE TABLE IF'); // 自動建表
    const list = await json(await handleRequest(post('/backup/list', { id: BID }), env, NOW));
    expect(list).toEqual({ items: [{ day: '2026-11-13', updatedAt: NOW, size: 12 }] });
    const got = await json(await handleRequest(post('/backup/get', { id: BID, day: '2026-11-13' }), env, NOW));
    expect(got).toEqual({ blob: 'AAAA-bbbb_01' });
    expect((await handleRequest(post('/backup/get', { id: BID, day: '2026-11-12' }), env, NOW)).status).toBe(404);
    expect((await handleRequest(post('/backup/delete', { id: BID }), env, NOW)).status).toBe(200);
    expect(await json(await handleRequest(post('/backup/list', { id: BID }), env, NOW))).toEqual({ items: [] });
    // 刪掉不存在的也是成功
    expect((await handleRequest(post('/backup/delete', { id: BID2 }), env, NOW)).status).toBe(200);
  });

  it('同一天再傳：覆蓋那一天（只留當天最後一次）', async () => {
    const { env, d1 } = await setup();
    await handleRequest(bput(BID, '2026-11-13', 'first'), env, NOW);
    await handleRequest(bput(BID, '2026-11-13', 'second'), env, NOW + 5000);
    expect(d1.rows).toHaveLength(1);
    const got = await json(await handleRequest(post('/backup/get', { id: BID, day: '2026-11-13' }), env, NOW));
    expect(got.blob).toBe('second');
    const list = await json(await handleRequest(post('/backup/list', { id: BID }), env, NOW));
    expect(list.items[0]).toMatchObject({ updatedAt: NOW + 5000, size: 6 });
  });

  it('只留最近 7 天：第 8 天進來時，最舊的那天被刪；別的代號不受影響', async () => {
    const { env, d1 } = await setup();
    await handleRequest(bput(BID2, '2026-10-01', 'other'), env, NOW);
    for (let d = 1; d <= 9; d++) await handleRequest(bput(BID, `2026-11-0${d}`, 'x' + d), env, NOW + d);
    const list = await json(await handleRequest(post('/backup/list', { id: BID }), env, NOW));
    expect(list.items.map((i) => i.day)).toEqual(['2026-11-09', '2026-11-08', '2026-11-07', '2026-11-06', '2026-11-05', '2026-11-04', '2026-11-03']);
    expect(list.items).toHaveLength(KEEP_DAYS);
    expect(d1.rows.filter((r) => r.id === BID2)).toHaveLength(1);
  });

  it('列出的日期由新到舊；只列自己的代號', async () => {
    const { env } = await setup();
    await handleRequest(bput(BID, '2026-11-10', 'a'), env, NOW);
    await handleRequest(bput(BID, '2026-11-12', 'b'), env, NOW);
    await handleRequest(bput(BID, '2026-11-11', 'c'), env, NOW);
    await handleRequest(bput(BID2, '2026-11-13', 'z'), env, NOW);
    const list = await json(await handleRequest(post('/backup/list', { id: BID }), env, NOW));
    expect(list.items.map((i) => i.day)).toEqual(['2026-11-12', '2026-11-11', '2026-11-10']);
    expect((await json(await handleRequest(post('/backup/list', { id: 'c'.repeat(64) }), env, NOW))).items).toEqual([]);
  });

  it('格式不對一律 400：代號、日期、內容', async () => {
    const { env, d1 } = await setup();
    const cases: [string, unknown][] = [
      ['/backup/put', { id: 'short', day: '2026-11-13', blob: 'abc' }],
      ['/backup/put', { id: 'A'.repeat(64), day: '2026-11-13', blob: 'abc' }], // 大寫不行
      ['/backup/put', { id: BID, day: '2026/11/13', blob: 'abc' }],
      ['/backup/put', { id: BID, day: '2026-11-13', blob: 'ab c' }],
      ['/backup/put', { id: BID, day: '2026-11-13', blob: 'ab+/=' }], // 不是 base64url
      ['/backup/put', { id: BID, day: '2026-11-13', blob: '' }],
      ['/backup/put', { id: BID, day: '2026-11-13', blob: 5 }],
      ['/backup/put', { id: BID, day: '2026-11-13' }],
      ['/backup/list', { id: 123 }],
      ['/backup/get', { id: BID, day: 'nope' }],
      ['/backup/delete', {}],
    ];
    for (const [path, body] of cases) expect((await handleRequest(post(path, body), env, NOW)).status).toBe(400);
    expect(d1.rows).toHaveLength(0);
    const bad = new Request('https://w.example.com/backup/put', { method: 'POST', headers: { Authorization: 'Bearer secret-123' }, body: '{not json' });
    expect((await handleRequest(bad, env, NOW)).status).toBe(400);
    expect((await handleRequest(post('/backup/other', { id: BID }), env, NOW)).status).toBe(404);
  });

  it('太大：內容超過 1,000,000 字元、整個請求超過約 1.5MB 都回 413；剛好上限可以', async () => {
    const { env, d1 } = await setup();
    expect((await handleRequest(bput(BID, '2026-11-13', 'a'.repeat(MAX_BLOB_CHARS + 1)), env, NOW)).status).toBe(413);
    expect((await handleRequest(bput(BID, '2026-11-13', 'a'.repeat(MAX_BLOB_CHARS)), env, NOW)).status).toBe(200);
    expect(d1.rows).toHaveLength(1);
    const huge = new Request('https://w.example.com/backup/put', { method: 'POST', headers: { Authorization: 'Bearer secret-123' }, body: JSON.stringify({ id: BID, day: '2026-11-13', blob: 'a'.repeat(1_600_000) }) });
    expect((await handleRequest(huge, env, NOW)).status).toBe(413);
  });

  it('推播路徑的大小上限仍是 200KB（備份放寬不影響它）', async () => {
    const { env } = await setup();
    const big = new Request('https://w.example.com/sync', { method: 'POST', headers: { Authorization: 'Bearer secret-123' }, body: JSON.stringify({ pad: 'a'.repeat(250_000) }) });
    expect((await handleRequest(big, env, NOW)).status).toBe(413);
  });

  it('代號總數上限（預設 20、可用 MAX_BACKUPS 調整）：新的代號被拒絕，已有的照常更新', async () => {
    const { env } = await setup({ MAX_BACKUPS: '2' });
    const ids = ['1', '2', '3'].map((c) => c.repeat(64).replace(/[^0-9a-f]/g, 'f'));
    expect((await handleRequest(bput(ids[0], '2026-11-13', 'a'), env, NOW)).status).toBe(200);
    expect((await handleRequest(bput(ids[1], '2026-11-13', 'b'), env, NOW)).status).toBe(200);
    const full = await handleRequest(bput(ids[2], '2026-11-13', 'c'), env, NOW);
    expect(full.status).toBe(403);
    expect(await json(full)).toEqual({ error: 'full' });
    expect((await handleRequest(bput(ids[0], '2026-11-14', 'again'), env, NOW)).status).toBe(200);
    // 刪掉一個之後，新的又可以進來
    await handleRequest(post('/backup/delete', { id: ids[1] }), env, NOW);
    expect((await handleRequest(bput(ids[2], '2026-11-13', 'c'), env, NOW)).status).toBe(200);
  });

  it('預設上限是 20 個代號', async () => {
    const { env } = await setup();
    const hex = (n: number) => n.toString(16).padStart(64, '0');
    for (let i = 0; i < 20; i++) expect((await handleRequest(bput(hex(i), '2026-11-13', 'a'), env, NOW)).status).toBe(200);
    expect((await handleRequest(bput(hex(20), '2026-11-13', 'a'), env, NOW)).status).toBe(403);
  });

  it('備份與推播互不干擾：備份不動 KV；推播同步不動 D1', async () => {
    const { env, store, d1 } = await setup();
    await handleRequest(bput(BID, '2026-11-13', 'abc'), env, NOW);
    expect(store.size).toBe(0);
    await handleRequest(post('/sync', { version: 1, subscription: SUB, reminders: [rem('a', NOW + 1000)] }), env, NOW);
    expect(d1.rows).toHaveLength(1);
    expect(store.size).toBeGreaterThan(0);
  });

  it('CORS：備份路徑回應也帶 CORS 標頭', async () => {
    const { env } = await setup({ ALLOWED_ORIGIN: 'https://me.github.io' });
    const res = await handleRequest(bput(BID, '2026-11-13', 'abc'), env, NOW);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://me.github.io');
    const pre = await handleRequest(new Request('https://w.example.com/backup/put', { method: 'OPTIONS' }), env, NOW);
    expect(pre.status).toBe(204);
  });
});
