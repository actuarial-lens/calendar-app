// @ts-nocheck
import { describe, expect, it } from 'vitest';
import worker, { LATE_MS, b64uDecode, b64uEncode, encryptPayload, handleRequest, runDue, userId, validateReminders, vapidAuthorization } from './worker.js';

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
