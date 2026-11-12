import { useEffect, useState } from 'react';
import { isPushConfigured } from '../notify/push';
import { isStandalone, notificationPermission, type PermissionState } from '../notify/native';
import type { Settings } from '../types';

interface Props {
  settings: Settings;
  closing: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onEnable: () => Promise<string>;
  onTest: () => Promise<string>;
  onClose: () => void;
}

const LEADS = [5, 10, 15, 30];
const PERMISSION_TEXT: Record<PermissionState, string> = {
  granted: '已允許',
  denied: '已拒絕',
  default: '尚未詢問',
  unsupported: '不支援',
};

export function SettingsPage({ settings, closing, onChange, onEnable, onTest, onClose }: Props) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<PermissionState>(notificationPermission());
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
          <h2 className="group-title">背景提醒</h2>
          <div className="group">
            <div className="row">
              <span>{isPushConfigured(settings) ? '背景提醒：已設定' : '背景提醒：尚未設定'}</span>
            </div>
          </div>
        </section>

        <section>
          <h2 className="group-title">關於通知（iPhone）</h2>
          <div className="group">
            <ul className="help">
              <li>要先用 Safari「分享 → 加入主畫面」，再從主畫面的圖示打開，iPhone 才會允許通知。</li>
              <li>通知權限一定要由你按「開啟通知」才會詢問，不會一打開就跳出來。</li>
              <li>在接上背景提醒之前，App 切到背景或鎖定螢幕後不會準時跳通知。下次打開時，最上方會列出「錯過的提醒」。</li>
            </ul>
          </div>
        </section>

        <p className="version">版本 {__APP_VERSION__}</p>
      </div>
    </div>
  );
}
