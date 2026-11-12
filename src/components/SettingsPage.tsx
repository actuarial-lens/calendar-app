import { useEffect, useRef, useState } from 'react';
import { isPushConfigured } from '../notify/push';
import { isStandalone, notificationPermission, type PermissionState } from '../notify/native';
import type { Settings } from '../types';

interface Props {
  settings: Settings;
  closing: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onEnable: () => Promise<string>;
  onTest: () => Promise<string>;
  onTestPush: () => Promise<string>;
  onExport: () => Promise<string>;
  onImport: (file: File) => Promise<string>;
  onClose: () => void;
}

const LEADS = [5, 10, 15, 30];
const PERMISSION_TEXT: Record<PermissionState, string> = {
  granted: '已允許',
  denied: '已拒絕',
  default: '尚未詢問',
  unsupported: '不支援',
};

export function SettingsPage({ settings, closing, onChange, onEnable, onTest, onTestPush, onExport, onImport, onClose }: Props) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<PermissionState>(notificationPermission());
  const fileRef = useRef<HTMLInputElement>(null);
  const setPush = (patch: Partial<Settings['push']>) => onChange({ push: { ...settings.push, ...patch } });
  const standalone = isStandalone();
  const enabled = settings.notificationsEnabled && permission === 'granted';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 注意：要求通知權限一定要在使用者點按鈕的當下呼叫，所以 onEnable 是第一個 await
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      setMessage(await fn());
    } catch {
      setMessage('發生錯誤，請稍後再試。');
    } finally {
      setPermission(notificationPermission());
      setBusy(false);
    }
  };

  return (
    <div className={'settings' + (closing ? ' closing' : '')} role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="settings-head">
        <button type="button" className="back" onClick={onClose} aria-label="返回">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 3.5L5.5 9l5.5 5.5" />
          </svg>
        </button>
        <h1 id="settings-title">設定</h1>
      </header>

      <div className="settings-body">
        <section>
          <h2 className="group-title">通知</h2>
          <div className="group">
            <div className="row">
              <span>已從主畫面開啟</span>
              <span className="value">{standalone ? '是' : '否'}</span>
            </div>
            <div className="row">
              <span>通知權限</span>
              <span className="value">{PERMISSION_TEXT[permission]}</span>
            </div>
            <div className="row buttons">
              <button type="button" className="btn-outline" disabled={busy || enabled} onClick={() => run(onEnable)}>
                {enabled ? '通知已開啟' : '開啟通知'}
              </button>
              <button type="button" className="btn-outline" disabled={busy} onClick={() => run(onTest)}>
                發送測試通知
              </button>
            </div>
            {message && <p className="row note" role="status">{message}</p>}
          </div>
        </section>

        <section>
          <h2 className="group-title">提醒時間</h2>
          <div className="group">
            <div className="row">
              <label htmlFor="morning">早上提醒時間</label>
              <input
                id="morning"
                type="time"
                className="time-field"
                value={settings.morningTime}
                onChange={(e) => e.target.value && onChange({ morningTime: e.target.value })}
              />
            </div>
            <div className="row stack" role="group" aria-labelledby="lead-l">
              <span id="lead-l">提前提醒（分鐘）</span>
              <div className="chips">
                {LEADS.map((m) => (
                  <button key={m} type="button" className="chip" aria-pressed={settings.leadMinutes === m} onClick={() => onChange({ leadMinutes: m })}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="group-title">背景提醒（選填）</h2>
          <div className="group">
            <div className="row">
              <span>{isPushConfigured(settings) ? '狀態：已設定' : '狀態：尚未設定'}</span>
            </div>
            <div className="row stack">
              <label htmlFor="push-url">伺服器網址</label>
              <input id="push-url" className="text-field" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="https://….workers.dev" value={settings.push.endpoint} onChange={(e) => setPush({ endpoint: e.target.value })} />
            </div>
            <div className="row stack">
              <label htmlFor="push-key">公鑰（VAPID_PUBLIC）</label>
              <input id="push-key" className="text-field" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={settings.push.vapidPublicKey} onChange={(e) => setPush({ vapidPublicKey: e.target.value })} />
            </div>
            <div className="row stack">
              <label htmlFor="push-secret">密碼（APP_SECRET）</label>
              <input id="push-secret" className="text-field" type="password" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={settings.push.secret} onChange={(e) => setPush({ secret: e.target.value })} />
            </div>
            <div className="row buttons">
              <button type="button" className="btn-outline" disabled={busy || !isPushConfigured(settings)} onClick={() => run(onTestPush)}>
                測試伺服器推播
              </button>
            </div>
          </div>
        </section>

        <section>
          <h2 className="group-title">資料備份</h2>
          <div className="group">
            <div className="row buttons">
              <button type="button" className="btn-outline" disabled={busy} onClick={() => run(onExport)}>
                匯出
              </button>
              <button type="button" className="btn-outline" disabled={busy} onClick={() => fileRef.current?.click()}>
                匯入
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void run(() => onImport(f));
                }}
              />
            </div>
            <p className="row note">資料只存在這支手機。匯出會產生檔案由你自己保存；匯入會合併進現有資料，不會刪除任何東西。</p>
          </div>
        </section>

        <section>
          <h2 className="group-title">關於通知（iPhone）</h2>
          <div className="group">
            <ul className="help">
              <li>要先用 Safari「分享 → 加入主畫面」，再從主畫面的圖示打開，iPhone 才會允許通知。</li>
              <li>通知權限一定要由你按「開啟通知」才會詢問，不會一打開就跳出來。</li>
              <li>沒有設定背景提醒時，App 切到背景或鎖定螢幕後不會準時跳通知。下次打開時，最上方會列出「錯過的提醒」。</li>
            </ul>
          </div>
        </section>

        <p className="version">版本 {__APP_VERSION__}</p>
      </div>
    </div>
  );
}
