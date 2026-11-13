/**
 * 新版 Service Worker 接手後不要馬上重新整理（會吃掉使用者打到一半的字）：
 * 記下「有新版」，等使用者離開 App（頁面變成 hidden）才重新整理，而且只做一次。
 */
export interface ReloadDeps {
  doc: {
    readonly visibilityState: string;
    addEventListener(type: 'visibilitychange', listener: () => void): void;
    removeEventListener(type: 'visibilitychange', listener: () => void): void;
  };
  save(): void; // 重新整理前保存畫面狀態
  reload(): void;
}

export function createUpdateReloader(deps: ReloadDeps): { needReload(): void; dispose(): void } {
  let pending = false;
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    try {
      deps.save();
    } catch {
      /* 存不了也要重新整理 */
    }
    deps.reload();
  };
  const onVisibility = () => {
    if (pending && deps.doc.visibilityState === 'hidden') go();
  };
  deps.doc.addEventListener('visibilitychange', onVisibility);
  return {
    needReload() {
      pending = true;
      if (deps.doc.visibilityState === 'hidden') go(); // 使用者本來就不在 App 裡
    },
    dispose() {
      deps.doc.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
