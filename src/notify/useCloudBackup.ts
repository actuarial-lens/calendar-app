import { useEffect, useMemo, useRef } from 'react';
import { db } from '../db/db';
import { useLive } from '../db/useLive';
import { todayISO } from '../lib/dates';
import type { CloudBackupState } from '../lib/cloudBackup';
import type { Note, Settings, Task } from '../types';
import { createCloudActions, createUploaderDeps, loadCloudState, realServer, type CloudActions } from './cloudActions';
import { CloudUploader, RETRY_MS } from './cloudSync';

interface Options {
  tasks: Task[] | undefined;
  notes: Note[] | undefined;
  settings: Settings | undefined;
}

/**
 * 接上雲端備份：資料或 3 個備份設定有變就排上傳（30 秒）；App 開啟、切到背景時各傳一次；
 * 失敗後每 60 秒、恢復連線時重試；伺服器網址與密碼剛填好時也試一次。
 * 回傳目前的雲端備份狀態（沒開啟時是 undefined）和各種操作。
 */
export function useCloudBackup({ tasks, notes, settings }: Options): { state: CloudBackupState | undefined; actions: CloudActions } {
  const { uploader, actions } = useMemo(() => {
    const uploader = new CloudUploader(createUploaderDeps(db, realServer, Date.now, () => todayISO()));
    return { uploader, actions: createCloudActions(db, uploader, realServer, Date.now) };
  }, []);
  const state = useLive(() => loadCloudState(db));

  const loaded = !!tasks && !!notes && !!settings;
  const seen = useRef(false);
  const morningEnabled = settings?.morningEnabled;
  const morningTime = settings?.morningTime;
  const leadMinutes = settings?.leadMinutes;

  // 資料變動 → 排上傳。第一次（剛載入）不算變動；開啟 App 時的上傳由下面的 boot 負責
  useEffect(() => {
    if (!loaded) return;
    if (!seen.current) {
      seen.current = true;
      void uploader.flush();
      return;
    }
    uploader.markDirty();
  }, [loaded, tasks, notes, morningEnabled, morningTime, leadMinutes, uploader]);

  // 伺服器網址與密碼從沒填變成填好：試著傳一次（已開啟、但先前沒填好而沒傳的情況）
  const cfgReady = !!settings && settings.push.endpoint.trim() !== '' && settings.push.secret.trim() !== '';
  const prevReady = useRef(cfgReady);
  useEffect(() => {
    if (cfgReady && !prevReady.current && seen.current) void uploader.flush();
    prevReady.current = cfgReady;
  }, [cfgReady, uploader]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && uploader.hasPending()) void uploader.flush({ keepalive: true });
    };
    const retry = () => void uploader.retryIfFailed();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') retry();
    }, RETRY_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', retry);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', retry);
      uploader.dispose();
    };
  }, [uploader]);

  return { state, actions };
}
