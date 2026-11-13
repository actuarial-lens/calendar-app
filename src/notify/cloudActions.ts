import type { AppDB } from '../db/db';
import { commit } from '../db/changes';
import { loadSettings, saveSettings } from '../db/settings';
import * as cloudApi from '../lib/cloudApi';
import type { CloudConfig, RemoteItem } from '../lib/cloudApi';
import {
  CLOUD_KEY, CloudError, decryptBackup, deriveKeys, normalizeCode, planCloudRestore, restoreSummary, settingsPatchFrom, type CloudBackupState,
} from '../lib/cloudBackup';
import { CloudUploader, type UploaderDeps } from './cloudSync';

/** 伺服器呼叫（測試時換成假的） */
export interface CloudServer {
  put: typeof cloudApi.putBackup;
  list: typeof cloudApi.listBackups;
  get: typeof cloudApi.getBackup;
  del: typeof cloudApi.deleteBackups;
}
export const realServer: CloudServer = { put: cloudApi.putBackup, list: cloudApi.listBackups, get: cloudApi.getBackup, del: cloudApi.deleteBackups };

export const loadCloudState = async (db: AppDB): Promise<CloudBackupState | undefined> => {
  const row = await db.kv.get(CLOUD_KEY);
  const v = row?.value as Partial<CloudBackupState> | undefined;
  return v && typeof v.code === 'string' ? (v as CloudBackupState) : undefined;
};

const errText = (e: unknown, fallback = '發生錯誤，請稍後再試。') => (e instanceof Error && e.message ? e.message : fallback);

async function loadConfig(db: AppDB): Promise<CloudConfig | null> {
  const { push } = await loadSettings(db);
  return push.endpoint.trim() && push.secret.trim() ? { endpoint: push.endpoint, secret: push.secret } : null;
}

/** 自動上傳要用的各種存取（資料庫、設定、伺服器） */
export function createUploaderDeps(db: AppDB, server: CloudServer, now: () => number, today: () => string): UploaderDeps {
  return {
    loadState: () => loadCloudState(db),
    patchState: async (set, remove = []) => {
      // 在交易裡讀改寫：自動上傳和使用者操作（更換還原碼、關閉）同時發生時，不會把對方的修改蓋回去
      await db.transaction('rw', db.kv, async () => {
        const cur = await loadCloudState(db);
        if (!cur) return;
        const next: CloudBackupState = { ...cur, ...set };
        for (const k of remove) delete next[k];
        await db.kv.put({ key: CLOUD_KEY, value: next });
      });
    },
    readSnapshot: async () => {
      const [tasks, notes, settings] = await Promise.all([db.tasks.toArray(), db.notes.toArray(), loadSettings(db)]);
      return { tasks, notes, settings };
    },
    config: () => loadConfig(db),
    put: (cfg, a) => server.put(cfg, a),
    now,
    today,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}

export interface CloudActions {
  /** 使用者按「我已存好」：真正開啟，並立刻上傳第一份 */
  enable(code: string): Promise<string>;
  backupNow(): Promise<string>;
  /** 用新碼上傳，成功後才切換、並請伺服器刪掉舊代號的全部備份 */
  rotate(newCode: string): Promise<string>;
  /** 關閉；deleteRemote：同時刪掉雲端上的備份（刪不掉就不關閉，讓使用者知道） */
  disable(deleteRemote: boolean): Promise<string>;
  /** 查詢這組還原碼在雲端有哪些日期（新到舊）；格式不對、查無資料會丟 CloudError */
  lookup(input: string): Promise<{ code: string; items: RemoteItem[] }>;
  restore(code: string, day: string): Promise<string>;
}

export function createCloudActions(db: AppDB, uploader: CloudUploader, server: CloudServer = realServer, now: () => number = Date.now): CloudActions {
  const needConfig = async (): Promise<CloudConfig> => {
    const cfg = await loadConfig(db);
    if (!cfg) throw new CloudError('config', '請先在上方「背景提醒」填好伺服器網址與密碼');
    return cfg;
  };
  const needState = async (): Promise<CloudBackupState> => {
    const s = await loadCloudState(db);
    if (!s) throw new CloudError('config', '尚未開啟雲端備份');
    return s;
  };

  return {
    async enable(code) {
      const norm = normalizeCode(code);
      if (!norm) return '還原碼格式不對';
      try {
        await needConfig();
        await db.kv.put({ key: CLOUD_KEY, value: { code: norm, enabledAt: now() } satisfies CloudBackupState });
        const r = await uploader.flush({ force: true });
        return r.ok ? '已開啟雲端備份，第一份備份完成。' : `已開啟，但第一次備份失敗：${r.error}，會自動重試。`;
      } catch (e) {
        return errText(e);
      }
    },

    async backupNow() {
      try {
        await needState();
        await needConfig();
        const r = await uploader.flush({ force: true });
        return r.ok ? '備份完成。' : `備份失敗：${r.error}，會自動重試。`;
      } catch (e) {
        return errText(e);
      }
    },

    async rotate(newCode) {
      const norm = normalizeCode(newCode);
      if (!norm) return '還原碼格式不對';
      try {
        const prev = await needState();
        const cfg = await needConfig();
        const oldId = (await deriveKeys(prev.code)).id;
        await db.kv.put({ key: CLOUD_KEY, value: { code: norm, enabledAt: prev.enabledAt } satisfies CloudBackupState });
        const r = await uploader.flush({ force: true });
        if (!r.ok) {
          await db.kv.put({ key: CLOUD_KEY, value: prev }); // 沒傳成功：維持原本的還原碼
          return `更換失敗：${r.error}，仍使用原本的還原碼。`;
        }
        try {
          await server.del(cfg, oldId);
        } catch (e) {
          return `已更換還原碼並完成備份，但舊的雲端備份沒有刪掉（${errText(e)}）。`;
        }
        return '已更換還原碼，新的備份完成，舊的雲端備份已刪除。';
      } catch (e) {
        return errText(e);
      }
    },

    async disable(deleteRemote) {
      try {
        const s = await needState();
        if (deleteRemote) {
          const cfg = await needConfig();
          await server.del(cfg, (await deriveKeys(s.code)).id);
        }
        await db.kv.delete(CLOUD_KEY); // 清掉手機上存的還原碼
        return deleteRemote ? '已關閉雲端備份，雲端上的備份已刪除。' : '已關閉雲端備份，雲端上的備份保留。';
      } catch (e) {
        return `${errText(e)}（尚未關閉）`;
      }
    },

    async lookup(input) {
      const code = normalizeCode(input);
      if (!code) throw new CloudError('format', '還原碼格式不對');
      const cfg = await needConfig();
      const items = await server.list(cfg, (await deriveKeys(code)).id);
      if (items.length === 0) throw new CloudError('not-found', '找不到這組還原碼的備份');
      return { code, items };
    },

    async restore(input, day) {
      try {
        const code = normalizeCode(input);
        if (!code) return '還原碼格式不對';
        const cfg = await needConfig();
        const { id, key } = await deriveKeys(code);
        const blob = await server.get(cfg, id, day);
        const { backup } = await decryptBackup(blob, key);

        // 這支手機還沒開啟雲端備份：用這組還原碼開啟（已經用別組碼開啟的不改）。先寫狀態，之後資料一變就會排上傳
        const had = await loadCloudState(db);
        if (!had) await db.kv.put({ key: CLOUD_KEY, value: { code, enabledAt: now() } satisfies CloudBackupState });

        const [tasks, notes] = await Promise.all([db.tasks.toArray(), db.notes.toArray()]);
        const plan = planCloudRestore(backup, tasks, notes);
        await commit(db, plan.changes);
        const patch = settingsPatchFrom(backup);
        if (Object.keys(patch).length) await saveSettings(db, patch);
        if (!had) uploader.markDirty();
        return restoreSummary(plan) + (had ? '' : plan.changes.putTasks.length + plan.changes.putNotes.length === 0 ? '這支手機已用這組還原碼開啟雲端備份。' : '。這支手機已用這組還原碼開啟雲端備份。');
      } catch (e) {
        return errText(e);
      }
    },
  };
}
