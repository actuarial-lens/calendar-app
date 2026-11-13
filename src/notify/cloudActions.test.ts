import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AppDB } from '../db/db';
import { loadSettings, saveSettings } from '../db/settings';
import { CloudError, CLOUD_KEY, deriveKeys, formatCode, generateCode } from '../lib/cloudBackup';
import type { RemoteItem } from '../lib/cloudApi';
import type { Note, Task } from '../types';
import { CloudUploader } from './cloudSync';
import { createCloudActions, createUploaderDeps, loadCloudState, type CloudServer } from './cloudActions';

let n = 0;
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, date: '2026-11-13', time: '', category: '待辦', title: id, note: '', done: false, delayDays: 0, createdAt: 1, updatedAt: 1, ...extra,
});
const note = (id: string, extra: Partial<Note> = {}): Note => ({ id, date: '2026-11-13', text: id, createdAt: 1, updatedAt: 1, ...extra });

/** 記憶體裡的假伺服器（內容是真的加密過的） */
function fakeServer() {
  const store = new Map<string, Map<string, { blob: string; updatedAt: number }>>();
  const calls: string[] = [];
  let fail: Error | null = null;
  const server: CloudServer = {
    put: async (_c, a) => {
      calls.push('put');
      if (fail) throw fail;
      const m = store.get(a.id) ?? new Map();
      m.set(a.day, { blob: a.blob, updatedAt: 1_800_000_000_000 });
      store.set(a.id, m);
    },
    list: async (_c, id): Promise<RemoteItem[]> => {
      calls.push('list');
      return [...(store.get(id) ?? new Map()).entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, v]) => ({ day, updatedAt: v.updatedAt, size: v.blob.length }));
    },
    get: async (_c, id, day) => {
      calls.push('get');
      const v = store.get(id)?.get(day);
      if (!v) throw new CloudError('not-found', '找不到這組還原碼的備份');
      return v.blob;
    },
    del: async (_c, id) => {
      calls.push('del');
      if (fail) throw fail;
      store.delete(id);
    },
  };
  return { server, store, calls, failWith: (e: Error | null) => (fail = e) };
}

async function phone(server: CloudServer, filled = true) {
  const db = new AppDB('cloud-' + n++);
  await db.open();
  if (filled) await saveSettings(db, { push: { endpoint: 'https://w.example.com', vapidPublicKey: '', secret: 'pw' } });
  const now = () => 1_800_000_000_000;
  const uploader = new CloudUploader(createUploaderDeps(db, server, now, () => '2026-11-13'));
  return { db, uploader, actions: createCloudActions(db, uploader, server, now) };
}

const CODE = generateCode();

describe('開啟雲端備份', () => {
  it('格式不對、還沒填伺服器：不開啟', async () => {
    const s = fakeServer();
    const p = await phone(s.server);
    expect(await p.actions.enable('abc')).toBe('還原碼格式不對');
    expect(await loadCloudState(p.db)).toBeUndefined();
    const q = await phone(s.server, false);
    expect(await q.actions.enable(formatCode(CODE))).toBe('請先在上方「背景提醒」填好伺服器網址與密碼');
    expect(await loadCloudState(q.db)).toBeUndefined();
    expect(s.calls).toEqual([]);
  });

  it('開啟：存還原碼、立刻上傳第一份（備份代號下有今天那一份）', async () => {
    const s = fakeServer();
    const p = await phone(s.server);
    await p.db.tasks.put(task('t1'));
    expect(await p.actions.enable(formatCode(CODE))).toBe('已開啟雲端備份，第一份備份完成。');
    const st = await loadCloudState(p.db);
    expect(st).toMatchObject({ code: CODE, enabledAt: 1_800_000_000_000, lastOkAt: 1_800_000_000_000 });
    expect(st!.lastHash).toMatch(/^[0-9a-f]{64}$/);
    const { id } = await deriveKeys(CODE);
    expect([...s.store.get(id)!.keys()]).toEqual(['2026-11-13']);
    // 伺服器上看不到還原碼與資料
    expect(JSON.stringify([...s.store.entries()])).not.toContain(CODE);
    expect(JSON.stringify([...s.store.entries()])).not.toContain('t1');
  });

  it('第一次上傳失敗：還是開啟，並說明會自動重試；記下 lastError', async () => {
    const s = fakeServer();
    s.failWith(new CloudError('network', '連不上伺服器，請檢查網路'));
    const p = await phone(s.server);
    const msg = await p.actions.enable(formatCode(CODE));
    expect(msg).toBe('已開啟，但第一次備份失敗：連不上伺服器，請檢查網路，會自動重試。');
    expect((await loadCloudState(p.db))!.lastError).toBe('連不上伺服器，請檢查網路');
    expect(p.uploader.hasPending()).toBe(true);
    s.failWith(null);
    expect((await p.uploader.retryIfFailed()!).ok).toBe(true);
    expect('lastError' in (await loadCloudState(p.db))!).toBe(false);
  });

  it('立即備份：沒變也再傳一次；沒開啟時提示', async () => {
    const s = fakeServer();
    const p = await phone(s.server);
    expect(await p.actions.backupNow()).toBe('尚未開啟雲端備份');
    await p.actions.enable(CODE);
    const before = s.calls.filter((c) => c === 'put').length;
    expect(await p.actions.backupNow()).toBe('備份完成。');
    expect(s.calls.filter((c) => c === 'put').length).toBe(before + 1);
  });
});

describe('從雲端還原（換手機）', () => {
  async function oldPhone(s: ReturnType<typeof fakeServer>) {
    const p = await phone(s.server);
    await p.db.tasks.bulkPut([task('t1', { title: '開會', note: '三樓', updatedAt: 5 }), task('t2', { deletedAt: 7, updatedAt: 7 }), task('t3', { done: true })]);
    await p.db.notes.bulkPut([note('n1', { text: '牛奶' }), note('n2', { deletedAt: 7, updatedAt: 7 })]);
    await saveSettings(p.db, { morningTime: '07:10', leadMinutes: 10, morningEnabled: false, notificationsEnabled: true });
    await p.actions.enable(CODE);
    return p;
  }

  it('全新手機：事項（含刪除過的）、隨手記、3 個設定都回來；伺服器設定不被動；自動用這組還原碼開啟', async () => {
    const s = fakeServer();
    await oldPhone(s);
    const p = await phone(s.server); // 新手機：只填了伺服器網址與密碼
    const { code, items } = await p.actions.lookup(formatCode(CODE).toLowerCase());
    expect(code).toBe(CODE);
    expect(items.map((i) => i.day)).toEqual(['2026-11-13']);
    const msg = await p.actions.restore(code, items[0].day);
    expect(msg).toBe('已還原：新增事項 2、更新 0；新增隨手記 1、更新 0。這支手機已用這組還原碼開啟雲端備份。');
    const all = await p.db.tasks.toArray();
    expect(all.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
    expect(all.find((t) => t.id === 't2')!.deletedAt).toBe(7); // 刪除的沒有復活
    expect(all.find((t) => t.id === 't1')).toMatchObject({ title: '開會', note: '三樓' });
    expect((await p.db.notes.toArray()).map((x) => x.id).sort()).toEqual(['n1', 'n2']);
    const st = await loadSettings(p.db);
    expect(st).toMatchObject({ morningTime: '07:10', leadMinutes: 10, morningEnabled: false });
    expect(st.notificationsEnabled).toBe(false); // 通知開關不備份
    expect(st.push).toMatchObject({ endpoint: 'https://w.example.com', secret: 'pw' }); // 伺服器設定維持新手機自己的
    expect((await loadCloudState(p.db))!.code).toBe(CODE);
    expect(p.uploader.hasPending()).toBe(true); // 資料變了，之後會上傳
  });

  it('手機上已有資料：合併、不刪現有資料、較新的留下；已用別組碼開啟的不改', async () => {
    const s = fakeServer();
    await oldPhone(s);
    const p = await phone(s.server);
    const OTHER = generateCode();
    await p.db.tasks.bulkPut([task('t1', { title: '手機上較新', updatedAt: 99 }), task('local-only'), task('t2', { updatedAt: 1 })]);
    await p.actions.enable(OTHER);
    const msg = await p.actions.restore(CODE, '2026-11-13');
    expect(msg).toBe('已還原：新增事項 1、更新 1；新增隨手記 1、更新 0'); // t3 新增；t2 被雲端的刪除紀錄取代（更新）；t1 手機較新不動
    const all = new Map((await p.db.tasks.toArray()).map((t) => [t.id, t]));
    expect(all.get('t1')!.title).toBe('手機上較新');
    expect(all.has('local-only')).toBe(true);
    expect(all.get('t2')!.deletedAt).toBe(7);
    expect((await loadCloudState(p.db))!.code).toBe(OTHER);
  });

  it('查詢：格式不對、查無資料的訊息；沒填伺服器的提示', async () => {
    const s = fakeServer();
    const p = await phone(s.server);
    await expect(p.actions.lookup('K7QM-4RTX')).rejects.toMatchObject({ message: '還原碼格式不對' });
    await expect(p.actions.lookup(generateCode())).rejects.toMatchObject({ message: '找不到這組還原碼的備份' });
    const q = await phone(s.server, false);
    await expect(q.actions.lookup(CODE)).rejects.toMatchObject({ code: 'config' });
  });

  it('內容被改壞：還原失敗並說明，手機資料不變', async () => {
    const s = fakeServer();
    await oldPhone(s);
    const { id } = await deriveKeys(CODE);
    const m = s.store.get(id)!;
    const v = m.get('2026-11-13')!;
    m.set('2026-11-13', { ...v, blob: v.blob.slice(0, -5) + 'AAAAA' });
    const p = await phone(s.server);
    expect(await p.actions.restore(CODE, '2026-11-13')).toBe('還原碼不正確，或備份已損毀');
    expect(await p.db.tasks.count()).toBe(0);
    expect(await loadCloudState(p.db)).toBeUndefined();
  });

  it('伺服器上沒有那一天：失敗並說明；連不上：說明', async () => {
    const s = fakeServer();
    await oldPhone(s);
    const p = await phone(s.server);
    expect(await p.actions.restore(CODE, '2020-01-01')).toBe('找不到這組還原碼的備份');
    expect(await p.actions.restore('bad', '2026-11-13')).toBe('還原碼格式不對');
  });

  it('只有 3 個設定有值才套用：備份裡沒有的設定不動', async () => {
    const s = fakeServer();
    await oldPhone(s);
    const p = await phone(s.server);
    await saveSettings(p.db, { morningTime: '06:00' });
    await p.actions.restore(CODE, '2026-11-13');
    expect((await loadSettings(p.db)).morningTime).toBe('07:10');
  });
});

describe('更換還原碼、關閉', () => {
  it('更換：用新碼上傳成功後才切換，舊代號的備份被刪除；伺服器上只剩新代號', async () => {
    const s = fakeServer();
    const p = await phone(s.server);
    await p.db.tasks.put(task('t1'));
    await p.actions.enable(CODE);
    const NEW = generateCode();
    expect(await p.actions.rotate(formatCode(NEW))).toBe('已更換還原碼，新的備份完成，舊的雲端備份已刪除。');
    expect((await loadCloudState(p.db))!.code).toBe(NEW);
    const [oldId, newId] = [(await deriveKeys(CODE)).id, (await deriveKeys(NEW)).id];
    expect(s.store.has(oldId)).toBe(false);
    expect(s.store.has(newId)).toBe(true);
  });

  it('更換時新碼上傳失敗：維持原本的還原碼，舊備份也不刪', async () => {
    const s = fakeServer();
    const p = await phone(s.server);
    await p.actions.enable(CODE);
    s.failWith(new CloudError('network', '連不上伺服器，請檢查網路'));
    const msg = await p.actions.rotate(generateCode());
    expect(msg).toBe('更換失敗：連不上伺服器，請檢查網路，仍使用原本的還原碼。');
    expect((await loadCloudState(p.db))!.code).toBe(CODE);
    expect(s.store.has((await deriveKeys(CODE)).id)).toBe(true);
  });

  it('關閉並刪除雲端：雲端清空、手機上的還原碼清掉；只關閉：雲端保留', async () => {
    const s = fakeServer();
    const p = await phone(s.server);
    await p.actions.enable(CODE);
    expect(await p.actions.disable(false)).toBe('已關閉雲端備份，雲端上的備份保留。');
    expect(await loadCloudState(p.db)).toBeUndefined();
    expect((await p.db.kv.get(CLOUD_KEY))).toBeUndefined();
    expect(s.store.size).toBe(1);
    await p.actions.enable(CODE);
    expect(await p.actions.disable(true)).toBe('已關閉雲端備份，雲端上的備份已刪除。');
    expect(s.store.size).toBe(0);
  });

  it('要刪雲端卻刪不掉：不關閉，讓使用者知道', async () => {
    const s = fakeServer();
    const p = await phone(s.server);
    await p.actions.enable(CODE);
    s.failWith(new CloudError('network', '連不上伺服器，請檢查網路'));
    expect(await p.actions.disable(true)).toBe('連不上伺服器，請檢查網路（尚未關閉）');
    expect(await loadCloudState(p.db)).toBeDefined();
  });

  it('關閉後自動上傳不再運作（沒有狀態就不傳）', async () => {
    const s = fakeServer();
    const p = await phone(s.server);
    await p.actions.enable(CODE);
    await p.actions.disable(false);
    const before = s.calls.length;
    p.uploader.markDirty();
    expect((await p.uploader.flush()).skipped).toBe(true);
    expect(s.calls.length).toBe(before);
  });
});
