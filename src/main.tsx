import '@fontsource/noto-sans-tc/chinese-traditional-400.css';
import '@fontsource/noto-sans-tc/chinese-traditional-500.css';
import '@fontsource/noto-sans-tc/chinese-traditional-700.css';
import '@fontsource/noto-sans-tc/latin-400.css';
import '@fontsource/noto-sans-tc/latin-500.css';
import '@fontsource/noto-sans-tc/latin-700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { db } from './db/db';
import { ensureRepeats, purgeExpired, removeSampleData, seedIfFirstRun } from './db/maintenance';
import { loadSettings } from './db/settings';
import { isISODate } from './lib/swLogic';
import { collectBootMissed } from './notify/boot';
import type { Reminder } from './lib/reminders';
import { todayISO } from './lib/dates';
import { getReloadSnapshot, mergeMissed, saveReloadState, takeReloadState } from './lib/reloadState';
import { createUpdateReloader } from './lib/updateReload';

async function boot() {
  let initialMissed: Reminder[] = [];
  try {
    await db.open();
    await purgeExpired(db);
    await removeSampleData(db); // 清掉以前版本放的範例資料（只做一次）
    if (new URLSearchParams(location.search).has('demo')) await seedIfFirstRun(db, todayISO()); // 示範／測試用
    await ensureRepeats(db, todayISO());
    // 找出關掉 App 期間錯過的提醒
    initialMissed = await collectBootMissed(db, await loadSettings(db));
  } catch (e) {
    console.error('資料庫啟動失敗', e);
  }

  // 點通知打開 App 時，網址帶 ?date=YYYY-MM-DD，跳到那一天
  const param = new URLSearchParams(location.search).get('date');
  // 新版部署後的重新整理：把重新整理前的「錯過的提醒」與日期接回來
  const saved = takeReloadState(sessionStorage);
  initialMissed = mergeMissed(initialMissed, saved.missed);
  const initialDay = isISODate(param) ? param : saved.day;
  if (param !== null) history.replaceState(null, '', location.pathname);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App initialMissed={initialMissed} initialDay={initialDay} />
    </StrictMode>,
  );
}

boot();

if (import.meta.env.PROD) {
  // 新版 Service Worker 接手後不馬上重新整理，等使用者離開 App 才做（不會吃掉打到一半的字）
  const reloader = createUpdateReloader({
    doc: document,
    save: () => saveReloadState(sessionStorage, getReloadSnapshot()),
    reload: () => location.reload(),
  });
  registerSW({ immediate: true, onNeedReload: reloader.needReload });
}
