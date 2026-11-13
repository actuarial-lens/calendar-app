import { describe, expect, it } from 'vitest';
import { listBackups, putBackup, getBackup, deleteBackups } from './cloudApi';
import {
  CODE_ALPHABET, CloudError, backupHash, backupTimeText, buildCloudBackup, decryptBackup, deriveKeys, encryptBackup, formatCode, generateCode,
  isCloudReady, normalizeCode, parseCloudBackup, planCloudRestore, restoreItemText, restoreSummary, settingsPatchFrom, b64uDecode, b64uEncode,
} from './cloudBackup';
import { DEFAULT_SETTINGS, type Note, type Task } from '../types';

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, date: '2026-11-13', time: '', category: '待辦', title: id, note: '', done: false, delayDays: 0, createdAt: 1, updatedAt: 1, ...extra,
});
const note = (id: string, extra: Partial<Note> = {}): Note => ({ id, date: '2026-11-13', text: id, createdAt: 1, updatedAt: 1, ...extra });
const SETTINGS = { ...DEFAULT_SETTINGS, morningTime: '07:45', leadMinutes: 15, notificationsEnabled: true, push: { endpoint: 'https://secret.example.com', vapidPublicKey: 'PUBKEY', secret: 'TOP-SECRET-PW' } };
const CODE = 'K7QM4RTX9WBN2HCEPZ6D';

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const utf8 = (s: string) => new TextEncoder().encode(s);

/** 獨立實作的 HKDF-SHA256（RFC 5869：extract ＋ expand，只用 HMAC），用來對照 WebCrypto 的 HKDF 結果 */
async function refHkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const hmac = async (key: Uint8Array, data: Uint8Array) => {
    const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource));
  };
  const prk = await hmac(salt, ikm);
  let t: Uint8Array = new Uint8Array(0);
  const out: number[] = [];
  for (let i = 1; out.length < length; i++) {
    const input = new Uint8Array(t.length + info.length + 1);
    input.set(t, 0);
    input.set(info, t.length);
    input[input.length - 1] = i;
    t = await hmac(prk, input);
    out.push(...t);
  }
  return Uint8Array.from(out.slice(0, length));
}

describe('還原碼', () => {
  it('產生：20 個字元、只用 Crockford Base32（沒有 I L O U）、每次不同', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const c = generateCode();
      expect(c).toHaveLength(20);
      expect([...c].every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
      expect(/[ILOU]/.test(c)).toBe(false);
      seen.add(c);
    }
    expect(seen.size).toBe(50);
    expect(CODE_ALPHABET).toHaveLength(32);
  });
  it('每個位元組取低 5 位元：位元組 0..255 每個字元出現的次數一樣（沒有偏差）', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const counts = new Map<string, number>();
    for (let i = 0; i < 256; i += 20) {
      const c = generateCode((a) => { for (let k = 0; k < a.length; k++) a[k] = all[(i + k) % 256]; return a; });
      expect(c).toHaveLength(20);
    }
    for (const b of all) counts.set(CODE_ALPHABET[b & 31], (counts.get(CODE_ALPHABET[b & 31]) ?? 0) + 1);
    expect(new Set(counts.values())).toEqual(new Set([8]));
    expect(generateCode((a) => a.fill(0))).toBe('0'.repeat(20));
    expect(generateCode((a) => a.fill(255))).toBe('Z'.repeat(20));
  });
  it('顯示格式：5 組、每組 4 個字元，用「-」分開', () => {
    expect(formatCode(CODE)).toBe('K7QM-4RTX-9WBN-2HCE-PZ6D');
  });
  it('輸入寬鬆處理：去空白與「-」、轉大寫、O→0、I／L→1', () => {
    expect(normalizeCode('K7QM-4RTX-9WBN-2HCE-PZ6D')).toBe(CODE);
    expect(normalizeCode(' k7qm 4rtx 9wbn 2hce pz6d ')).toBe(CODE);
    expect(normalizeCode('k7qm4rtx9wbn2hcepz6d')).toBe(CODE);
    expect(normalizeCode('O1IL-0000-0000-0000-0000')).toBe('0111' + '0'.repeat(16));
    expect(normalizeCode('oiL0-0000-0000-0000-0000')).toBe('0110' + '0'.repeat(16));
  });
  it('不是 20 個有效字元：回 null（還原碼格式不對）', () => {
    expect(normalizeCode('')).toBeNull();
    expect(normalizeCode('K7QM-4RTX')).toBeNull();
    expect(normalizeCode(CODE + 'A')).toBeNull();
    expect(normalizeCode('U7QM-4RTX-9WBN-2HCE-PZ6D')).toBeNull(); // U 不在字元集
    expect(normalizeCode('K7QM-4RTX-9WBN-2HCE-PZ6!')).toBeNull();
    expect(normalizeCode('我是還原碼我是還原碼我是還原碼我是還原碼我是')).toBeNull();
  });
  it('產生的碼可以被正規化回自己', () => {
    for (let i = 0; i < 20; i++) {
      const c = generateCode();
      expect(normalizeCode(formatCode(c))).toBe(c);
    }
  });
});

describe('金鑰衍生（HKDF-SHA256）', () => {
  it('備份代號：64 個十六進位字元；和獨立實作（Node crypto）算出來的一樣', async () => {
    const { id } = await deriveKeys(CODE);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).toBe(toHex(await refHkdf(utf8(CODE), utf8('calendar-app-backup-v1'), utf8('id'), 32)));
  });
  it('金鑰：和獨立實作算出來的 key 位元組一樣（同樣的 IV 加密結果相同）', async () => {
    const { key } = await deriveKeys(CODE);
    const raw = await refHkdf(utf8(CODE), utf8('calendar-app-backup-v1'), utf8('key'), 32);
    const ref = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt']);
    const iv = new Uint8Array(12).fill(7);
    const a = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('hello')));
    const b = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ref, new TextEncoder().encode('hello')));
    expect(toHex(a)).toBe(toHex(b));
  });
  it('同一組碼結果固定；不同碼不同；代號和金鑰不同源（id 反推不出 key）', async () => {
    const a1 = await deriveKeys(CODE);
    const a2 = await deriveKeys(CODE);
    const b = await deriveKeys('K7QM4RTX9WBN2HCEPZ6E');
    expect(a1.id).toBe(a2.id);
    expect(a1.id).not.toBe(b.id);
    expect(a1.id).not.toContain(CODE);
    // 同樣的 IV：金鑰相同 → 密文相同；金鑰不同 → 密文不同
    const bk = (k: CryptoKey) => crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, k, new Uint8Array(4)).then((x) => toHex(new Uint8Array(x)));
    expect(await bk(a1.key)).toBe(await bk(a2.key));
    expect(await bk(a1.key)).not.toBe(await bk(b.key));
  });
});

describe('備份內容', () => {
  const tasks = [task('t1'), task('t2', { deletedAt: 500, updatedAt: 500 })];
  const notes = [note('n1'), note('n2', { deletedAt: 500, updatedAt: 500 })];
  it('包含軟刪除（有 deletedAt）的事項與隨手記；有格式、版本、時間', () => {
    const b = buildCloudBackup(tasks, notes, SETTINGS, 1234);
    expect(b).toMatchObject({ format: 'calendar-cloud-backup', version: 1, exportedAt: 1234 });
    expect(b.tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(b.tasks[1].deletedAt).toBe(500);
    expect(b.notes.map((n) => n.id)).toEqual(['n1', 'n2']);
  });
  it('只帶 3 個提醒設定；伺服器網址、公鑰、密碼、通知開關一律不備份（連同字串都不出現）', () => {
    const b = buildCloudBackup(tasks, notes, SETTINGS, 1);
    expect(b.settings).toEqual({ morningEnabled: true, morningTime: '07:45', leadMinutes: 15 });
    const text = JSON.stringify(b);
    for (const secret of ['secret.example.com', 'PUBKEY', 'TOP-SECRET-PW', 'notificationsEnabled', 'push']) expect(text).not.toContain(secret);
  });
  it('順序固定（依 id），雜湊不含 exportedAt：同樣的資料同樣的雜湊', async () => {
    const h1 = await backupHash(buildCloudBackup([task('b'), task('a')], [], SETTINGS, 1));
    const h2 = await backupHash(buildCloudBackup([task('a'), task('b')], [], SETTINGS, 99999));
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    const h3 = await backupHash(buildCloudBackup([task('a'), task('b', { title: '改了' })], [], SETTINGS, 1));
    expect(h3).not.toBe(h1);
    const h4 = await backupHash(buildCloudBackup([task('a'), task('b')], [], { ...SETTINGS, leadMinutes: 5 }, 1));
    expect(h4).not.toBe(h1);
  });
});

describe('加密與解密', () => {
  const backup = buildCloudBackup([task('t1', { title: '開會', note: '三樓\n帶筆電' }), task('t2', { deletedAt: 9 })], [note('n1', { text: '想買牛奶 🥛' })], SETTINGS, 777);

  it('加密後解密還原：內容完全一樣（含中文、換行、emoji、刪除紀錄）', async () => {
    const { key } = await deriveKeys(CODE);
    const blob = await encryptBackup(backup, key);
    const out = await decryptBackup(blob, key);
    expect(out.backup).toEqual(backup);
    expect(out.skipped).toBe(0);
  });
  it('格式：base64url（沒有 + / =）、第一個位元組 0x01、接著 12 位元組 IV', async () => {
    const { key } = await deriveKeys(CODE);
    const iv = Uint8Array.from({ length: 12 }, (_, i) => i + 1);
    const blob = await encryptBackup(backup, key, iv);
    expect(blob).toMatch(/^[A-Za-z0-9_-]+$/);
    const bytes = b64uDecode(blob);
    expect(bytes[0]).toBe(1);
    expect([...bytes.slice(1, 13)]).toEqual([...iv]);
    // 密文不含明文
    expect(new TextDecoder().decode(bytes)).not.toContain('開會');
  });
  it('每次加密的 IV 都不同（同樣的內容，密文也不同）', async () => {
    const { key } = await deriveKeys(CODE);
    expect(await encryptBackup(backup, key)).not.toBe(await encryptBackup(backup, key));
  });
  it('用錯的還原碼解密：失敗（還原碼不正確，或備份已損毀）', async () => {
    const { key } = await deriveKeys(CODE);
    const wrong = await deriveKeys('K7QM4RTX9WBN2HCEPZ6E');
    const blob = await encryptBackup(backup, key);
    await expect(decryptBackup(blob, wrong.key)).rejects.toMatchObject({ code: 'decrypt', message: '還原碼不正確，或備份已損毀' });
  });
  it('內容被改過、被截斷、不是 base64、太短：都解不開', async () => {
    const { key } = await deriveKeys(CODE);
    const blob = await encryptBackup(backup, key);
    const bytes = b64uDecode(blob);
    bytes[bytes.length - 3] ^= 1;
    await expect(decryptBackup(b64uEncode(bytes), key)).rejects.toBeInstanceOf(CloudError);
    await expect(decryptBackup(blob.slice(0, 40), key)).rejects.toBeInstanceOf(CloudError);
    await expect(decryptBackup('***', key)).rejects.toBeInstanceOf(CloudError);
    await expect(decryptBackup('', key)).rejects.toBeInstanceOf(CloudError);
  });
  it('版本位元組較新：請先更新 App', async () => {
    const { key } = await deriveKeys(CODE);
    const bytes = b64uDecode(await encryptBackup(backup, key));
    bytes[0] = 2;
    await expect(decryptBackup(b64uEncode(bytes), key)).rejects.toMatchObject({ code: 'version' });
  });
  it('解開了但內容格式不對（或版本較新）：丟 CloudError', async () => {
    const { key } = await deriveKeys(CODE);
    const evil = await encryptBackup({ ...backup, format: 'other' } as never, key);
    await expect(decryptBackup(evil, key)).rejects.toMatchObject({ code: 'decrypt' });
    const newer = await encryptBackup({ ...backup, version: 2 } as never, key);
    await expect(decryptBackup(newer, key)).rejects.toMatchObject({ code: 'version', message: '備份版本較新，請先更新 App' });
  });
  it('大量資料（2000 筆）加解密沒問題', async () => {
    const big = buildCloudBackup(Array.from({ length: 2000 }, (_, i) => task('id' + i, { title: '事項' + i, note: '備註內容'.repeat(10) })), [], SETTINGS, 1);
    const { key } = await deriveKeys(CODE);
    const blob = await encryptBackup(big, key);
    expect((await decryptBackup(blob, key)).backup.tasks).toHaveLength(2000);
  });
});

describe('parseCloudBackup', () => {
  it('壞掉的紀錄略過並計數；刪除過的紀錄照樣接受；設定缺漏用預設、不合格的欄位不動', () => {
    const raw = { format: 'calendar-cloud-backup', version: 1, exportedAt: 1, tasks: [task('ok'), task('dead', { deletedAt: 5 }), { id: 'bad' }], notes: [note('n'), null], settings: { morningEnabled: false, morningTime: 'x', leadMinutes: 7 } };
    const r = parseCloudBackup(raw);
    expect(r.ok && r.backup.tasks.map((t) => t.id)).toEqual(['ok', 'dead']);
    expect(r.ok && r.skipped).toBe(2);
    expect(r.ok && r.backup.settings).toEqual({ morningEnabled: false, morningTime: '08:30', leadMinutes: 30 });
    expect(settingsPatchFrom(raw)).toEqual({ morningEnabled: false });
    expect(settingsPatchFrom({ settings: { morningTime: '06:05', leadMinutes: 10 } })).toEqual({ morningTime: '06:05', leadMinutes: 10 });
    expect(settingsPatchFrom({})).toEqual({});
  });
  it('不是雲端備份格式、版本較新：失敗', () => {
    expect(parseCloudBackup(null).ok).toBe(false);
    expect(parseCloudBackup({ format: 'calendar-backup', version: 1, tasks: [], notes: [] }).ok).toBe(false);
    const newer = parseCloudBackup({ format: 'calendar-cloud-backup', version: 9, tasks: [], notes: [] });
    expect(newer).toMatchObject({ ok: false, version: true });
  });
});

describe('還原：合併（含刪除紀錄）', () => {
  const mk = (over: Partial<Task>) => task('x', over);
  it('依 id、updatedAt 較新的留下，絕不刪除現有資料；備份裡的刪除紀錄也帶進來', () => {
    const local = [mk({ id: 'same', updatedAt: 10, title: '本機較新' }), mk({ id: 'old', updatedAt: 1, title: '本機較舊' }), mk({ id: 'only-local' })];
    const backup = buildCloudBackup(
      [mk({ id: 'same', updatedAt: 5, title: '雲端較舊' }), mk({ id: 'old', updatedAt: 9, title: '雲端較新' }), mk({ id: 'new' }), mk({ id: 'gone', deletedAt: 3, updatedAt: 3 })],
      [note('n-new'), note('n-dead', { deletedAt: 2, updatedAt: 2 })],
      SETTINGS,
      1,
    );
    const plan = planCloudRestore(backup, local, []);
    const put = new Map(plan.changes.putTasks.map((t) => [t.id, t]));
    expect([...put.keys()].sort()).toEqual(['gone', 'new', 'old']);
    expect(put.get('old')!.title).toBe('雲端較新');
    expect(put.get('gone')!.deletedAt).toBe(3); // 刪過的紀錄帶進來，不會復活
    expect(plan.changes.delTaskIds).toEqual([]);
    expect(plan.changes.delNoteIds).toEqual([]);
    expect(plan.changes.putNotes.map((n) => n.id).sort()).toEqual(['n-dead', 'n-new']);
    // 顯示的件數：新增只算沒被刪掉的
    expect(plan).toMatchObject({ shownAddedTasks: 1, updatedTasks: 1, shownAddedNotes: 1, updatedNotes: 0 });
    expect(restoreSummary(plan)).toBe('已還原：新增事項 1、更新 1；新增隨手記 1、更新 0');
  });
  it('手機上的事項比備份裡「刪除」的紀錄新：不被刪掉', () => {
    const local = [mk({ id: 'a', updatedAt: 50 })];
    const plan = planCloudRestore(buildCloudBackup([mk({ id: 'a', deletedAt: 10, updatedAt: 10 })], [], SETTINGS, 1), local, []);
    expect(plan.changes.putTasks).toEqual([]);
  });
  it('全都已經有了：提示沒有需要還原的', () => {
    const t = mk({ id: 'a' });
    const plan = planCloudRestore(buildCloudBackup([t], [], SETTINGS, 1), [t], []);
    expect(restoreSummary(plan)).toBe('雲端的資料這支手機都已經有了，沒有需要還原的。');
  });
});

describe('小工具', () => {
  it('isCloudReady：只看伺服器網址與密碼（不看公鑰）', () => {
    const base = DEFAULT_SETTINGS;
    expect(isCloudReady(base)).toBe(false);
    expect(isCloudReady({ push: { endpoint: 'https://x', vapidPublicKey: '', secret: 'p' } })).toBe(true);
    expect(isCloudReady({ push: { endpoint: ' ', vapidPublicKey: 'k', secret: 'p' } })).toBe(false);
    expect(isCloudReady({ push: { endpoint: 'https://x', vapidPublicKey: 'k', secret: '' } })).toBe(false);
  });
  it('時間文字：今天 22:40／11/12（四）08:15', () => {
    const d = new Date(2026, 10, 13, 22, 40).getTime();
    expect(backupTimeText(d, '2026-11-13')).toBe('今天 22:40');
    expect(backupTimeText(new Date(2026, 10, 12, 8, 15).getTime(), '2026-11-13')).toBe('11/12（四）08:15');
    expect(restoreItemText('2026-11-13', d)).toBe('11/13（五）22:40');
  });
});

describe('伺服器呼叫與錯誤訊息', () => {
  const cfg = { endpoint: 'https://w.example.com/', secret: ' pw ' };
  const res = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const expectErr = async (p: Promise<unknown>, code: string, msg: string) => {
    await expect(p).rejects.toMatchObject({ name: 'CloudError', code, message: msg });
  };

  it('帶 Bearer 密碼、去掉網址結尾斜線；keepalive 只在要求時帶', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response('{"ok":true}'))) as unknown as typeof fetch;
    await putBackup(cfg, { id: 'a'.repeat(64), day: '2026-11-13', blob: 'abc' }, f);
    expect(seen!.url).toBe('https://w.example.com/backup/put');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer pw');
    expect(JSON.parse(seen!.init.body as string)).toEqual({ id: 'a'.repeat(64), day: '2026-11-13', blob: 'abc' });
    expect('keepalive' in seen!.init).toBe(false);
    await putBackup(cfg, { id: 'a'.repeat(64), day: '2026-11-13', blob: 'abc', keepalive: true }, f);
    expect(seen!.init.keepalive).toBe(true);
  });
  it('401、501、413、403、404、其他狀態、連不上：對應的訊息', async () => {
    const put = (f: typeof fetch) => putBackup(cfg, { id: 'a'.repeat(64), day: '2026-11-13', blob: 'abc' }, f);
    await expectErr(put(res(401)), 'auth', '伺服器密碼不正確');
    await expectErr(put(res(501, { error: 'no-db' })), 'no-db', '伺服器還沒設定雲端備份（請依說明建立 D1 資料庫）');
    await expectErr(put(res(413)), 'too-large', '資料太大，無法備份');
    await expectErr(put(res(403, { error: 'full' })), 'full', '伺服器上的備份數量已滿');
    await expectErr(put(res(500)), 'server', '伺服器回應 500，請檢查設定');
    await expectErr(put((async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch), 'network', '連不上伺服器，請檢查網路');
    await expectErr(getBackup(cfg, 'a'.repeat(64), '2026-11-13', res(404)), 'not-found', '找不到這組還原碼的備份');
  });
  it('上傳內容超過上限：不用送出就回報資料太大', async () => {
    let called = false;
    const f = (async () => ((called = true), new Response('{}'))) as unknown as typeof fetch;
    await expectErr(putBackup(cfg, { id: 'a'.repeat(64), day: '2026-11-13', blob: 'a'.repeat(1_000_001) }, f), 'too-large', '資料太大，無法備份');
    expect(called).toBe(false);
  });
  it('沒填伺服器網址或密碼：不送出', async () => {
    let called = false;
    const f = (async () => ((called = true), new Response('{}'))) as unknown as typeof fetch;
    await expect(listBackups({ endpoint: '', secret: 'x' }, 'a'.repeat(64), f)).rejects.toMatchObject({ code: 'config' });
    await expect(deleteBackups({ endpoint: 'https://x', secret: ' ' }, 'a'.repeat(64), f)).rejects.toMatchObject({ code: 'config' });
    expect(called).toBe(false);
  });
  it('list：只收格式正確的項目；get：回內容；delete 成功', async () => {
    const items = await listBackups(cfg, 'a'.repeat(64), res(200, { items: [{ day: '2026-11-13', updatedAt: 5, size: 3 }, { day: 1 }, null] }));
    expect(items).toEqual([{ day: '2026-11-13', updatedAt: 5, size: 3 }]);
    expect(await getBackup(cfg, 'a'.repeat(64), '2026-11-13', res(200, { blob: 'xyz' }))).toBe('xyz');
    await expectErr(getBackup(cfg, 'a'.repeat(64), '2026-11-13', res(200, {})), 'not-found', '找不到這組還原碼的備份');
    await expect(deleteBackups(cfg, 'a'.repeat(64), res(200, { ok: true }))).resolves.toBeUndefined();
  });
});
