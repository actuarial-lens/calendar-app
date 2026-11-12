// Calendar 推播伺服器（Cloudflare Worker）
//
// 做的事：
//   1. 收 App 送來的「接下來幾天的提醒排程」，存在 KV（只存排程與推播訂閱，不存事項本身）
//   2. 每分鐘檢查一次，到點的提醒用 Web Push 推給那支手機
// 需要的設定（在 Cloudflare 後台設定，見 server/README.md）：
//   KV 綁定：PUSH_KV
//   環境變數：VAPID_PUBLIC、VAPID_PRIVATE、VAPID_SUBJECT、APP_SECRET
//   選用：ALLOWED_ORIGIN（只允許你的 App 網址呼叫）、MAX_USERS（預設 10）
// 沒有任何依賴套件，整個檔案貼上去就能用。

const enc = new TextEncoder();

/** 到點之後最多晚多久還補送（毫秒）。更晚的就不送，App 打開時會列在「錯過的提醒」 */
export const LATE_MS = 30 * 60 * 1000;
const MAX_BODY_BYTES = 200 * 1024;
const MAX_REMINDERS = 500;
const MAX_SEND_PER_USER_PER_RUN = 10;

// ---------- base64url ----------
export function b64uEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const raw = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

// ---------- Web Push 加密（RFC 8291，aes128gcm） ----------
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/**
 * 加密推播內容。
 * sub：{ p256dh, auth }（base64url）；opts 只給測試用（固定的暫時金鑰與 salt）
 * 回傳整個要 POST 的內容（含標頭資訊）。
 */
export async function encryptPayload(plaintext, sub, opts = {}) {
  const uaPublic = b64uDecode(sub.p256dh);
  const authSecret = b64uDecode(sub.auth);

  const asPair =
    opts.asKeyPair ?? (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asPair.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPair.privateKey, 256));

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);

  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const data = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const padded = concat(data, new Uint8Array([2])); // 0x02 = 最後一筆資料的結尾標記
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, padded));

  const rs = new Uint8Array([0, 0, 0x10, 0]); // 紀錄大小 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// ---------- VAPID（RFC 8292） ----------
async function importVapidKey(env) {
  const pub = b64uDecode(env.VAPID_PUBLIC);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC 格式不對');
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), d: env.VAPID_PRIVATE },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/** 組出 Authorization 標頭：vapid t=<JWT>, k=<公鑰> */
export async function vapidAuthorization(endpoint, env, nowSec) {
  const header = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64uEncode(
    enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: env.VAPID_SUBJECT })),
  );
  const input = `${header}.${claims}`;
  const key = await importVapidKey(env);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(input)));
  return `vapid t=${input}.${b64uEncode(sig)}, k=${env.VAPID_PUBLIC}`;
}

/** 送出一則推播。回傳推播服務的 HTTP 狀態碼 */
export async function sendPush(subscription, message, env, fetchFn = fetch, nowSec = Math.floor(Date.now() / 1000)) {
  const body = await encryptPayload(JSON.stringify(message), subscription.keys);
  const res = await fetchFn(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, env, nowSec),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '1800',
      Urgency: 'high',
    },
    body,
  });
  return res.status;
}

// ---------- 儲存（KV） ----------
// index            ：所有使用者的代號清單（只有新增／移除使用者時才寫）
// u:<代號>         ：{ subscription, reminders, updatedAt }（App 同步時才寫）
// s:<代號>         ：已送出的提醒 id（只有到點推播時才寫）。分開存，這樣同步和推播不會互相蓋掉。
export async function userId(endpoint) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(endpoint)));
  return [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const getJSON = async (env, key, fallback) => (await env.PUSH_KV.get(key, 'json')) ?? fallback;
const putJSON = (env, key, value, opts) => env.PUSH_KV.put(key, JSON.stringify(value), opts);

async function removeUser(env, id) {
  const index = (await getJSON(env, 'index', [])).filter((x) => x !== id);
  await putJSON(env, 'index', index);
  await Promise.all([env.PUSH_KV.delete('u:' + id), env.PUSH_KV.delete('s:' + id)]);
}

// ---------- 驗證輸入 ----------
const str = (v, max) => typeof v === 'string' && v.length <= max;

export function validateSubscription(sub) {
  if (!sub || typeof sub !== 'object') return null;
  if (!str(sub.endpoint, 1000) || !sub.endpoint.startsWith('https://')) return null;
  const k = sub.keys;
  if (!k || !str(k.p256dh, 200) || !str(k.auth, 100)) return null;
  try {
    if (b64uDecode(k.p256dh).length !== 65 || b64uDecode(k.auth).length !== 16) return null;
  } catch {
    return null;
  }
  return { endpoint: sub.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
}

export function validateReminders(list) {
  if (!Array.isArray(list) || list.length > MAX_REMINDERS) return null;
  const out = [];
  for (const r of list) {
    if (!r || !str(r.id, 200) || !Number.isFinite(r.at) || !str(r.title, 300) || !str(r.body, 500)) return null;
    out.push({
      id: r.id,
      at: r.at,
      title: r.title,
      body: r.body,
      date: typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : undefined,
    });
  }
  return out;
}

function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- 處理要求 ----------
function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}
const reply = (env, status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors(env) } });

export async function handleRequest(request, env, now = Date.now(), fetchFn = fetch) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  if (request.method === 'GET' && path === '/') return reply(env, 200, { ok: true });
  if (request.method !== 'POST') return reply(env, 405, { error: 'method' });

  const auth = request.headers.get('Authorization') ?? '';
  if (!sameSecret(auth.replace(/^Bearer\s+/i, ''), env.APP_SECRET)) return reply(env, 401, { error: 'auth' });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return reply(env, 413, { error: 'too large' });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(env, 400, { error: 'json' });
  }
  const subscription = validateSubscription(body?.subscription);
  if (!subscription) return reply(env, 400, { error: 'subscription' });
  const id = await userId(subscription.endpoint);

  if (path === '/unsubscribe') {
    await removeUser(env, id);
    return reply(env, 200, { ok: true });
  }

  if (path === '/test') {
    const status = await sendPush(
      subscription,
      { title: '測試推播', body: '看到這則通知，代表背景提醒設定成功。', id: 'test:' + now },
      env,
      fetchFn,
      Math.floor(now / 1000),
    );
    return reply(env, status >= 200 && status < 300 ? 200 : 502, { ok: status < 300, pushStatus: status });
  }

  if (path === '/sync' || path === '/schedule') {
    if (body.version !== 1) return reply(env, 400, { error: 'version' });
    const reminders = validateReminders(body.reminders);
    if (!reminders) return reply(env, 400, { error: 'reminders' });
    const index = await getJSON(env, 'index', []);
    if (!index.includes(id)) {
      const max = Number(env.MAX_USERS) || 10;
      if (index.length >= max) return reply(env, 403, { error: 'full' });
      await putJSON(env, 'index', [...index, id]);
    }
    // 已經過了很久的提醒不用存
    const keep = reminders.filter((r) => r.at > now - LATE_MS);
    await putJSON(env, 'u:' + id, { subscription, reminders: keep, updatedAt: now });
    return reply(env, 200, { ok: true, stored: keep.length });
  }

  return reply(env, 404, { error: 'not found' });
}

// ---------- 每分鐘執行：到點的就推播 ----------
export async function runDue(env, now = Date.now(), fetchFn = fetch) {
  const index = await getJSON(env, 'index', []);
  const result = { sent: 0, failed: 0, removed: 0 };
  for (const id of index) {
    const user = await getJSON(env, 'u:' + id, null);
    if (!user) continue;
    const sent = new Set(await getJSON(env, 's:' + id, []));
    const due = user.reminders
      .filter((r) => r.at <= now && r.at > now - LATE_MS && !sent.has(r.id))
      .sort((a, b) => a.at - b.at)
      .slice(0, MAX_SEND_PER_USER_PER_RUN);
    let changed = false;
    for (const r of due) {
      let status = 0;
      try {
        status = await sendPush(user.subscription, { title: r.title, body: r.body, date: r.date, id: r.id }, env, fetchFn, Math.floor(now / 1000));
      } catch {
        status = 0;
      }
      if (status === 404 || status === 410) {
        await removeUser(env, id); // 手機已經取消訂閱
        result.removed += 1;
        changed = false;
        break;
      }
      if (status >= 200 && status < 300) {
        sent.add(r.id);
        changed = true;
        result.sent += 1;
      } else {
        result.failed += 1; // 下一分鐘再試（超過 30 分鐘就放棄）
      }
    }
    if (changed) {
      const live = new Set(user.reminders.map((r) => r.id));
      await putJSON(env, 's:' + id, [...sent].filter((x) => live.has(x)));
    }
  }
  return result;
}

export default {
  fetch: (request, env) => handleRequest(request, env),
  scheduled: (event, env, ctx) => ctx.waitUntil(runDue(env)),
};
