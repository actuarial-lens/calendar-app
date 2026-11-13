import { useState } from 'react';
import { ONE_PHONE_NOTE, backupTimeText, formatCode, generateCode, isCloudReady, restoreItemText, revertConfirmText, type CloudBackupState } from '../lib/cloudBackup';
import type { Changes } from '../lib/changes';
import type { RemoteItem } from '../lib/cloudApi';
import type { CloudActions, RestoreMode } from '../notify/cloudActions';
import { usePresence } from '../lib/usePresence';
import type { Settings } from '../types';
import { Sheet } from './Sheet';

interface Props {
  settings: Settings;
  today: string;
  state: CloudBackupState | undefined;
  actions: CloudActions;
  /** 這支手機現有的（沒被刪掉的）事項與隨手記數量，還原前提醒用 */
  liveCount: number;
}

/** 目前開著的面板 */
type Panel =
  | { kind: 'code'; code: string; mode: 'enable' | 'rotate' | 'show' }
  | { kind: 'restore' }
  | { kind: 'rotate-ask' }
  | { kind: 'disable' };

/** 設定頁的「雲端備份」區塊 */
export function CloudBackupSection({ settings, today, state, actions, liveCount }: Props) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const p = usePresence(panel, 340);
  const ready = isCloudReady(settings);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      setMessage(await fn());
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : '發生錯誤，請稍後再試。');
    } finally {
      setBusy(false);
    }
  };

  const status = !state
    ? null
    : state.lastError
      ? { text: `備份失敗：${state.lastError}，會自動重試`, bad: true }
      : { text: state.lastOkAt ? `上次備份：${backupTimeText(state.lastOkAt, today)}` : '尚未完成第一次備份', bad: false };

  return (
    <section>
      <h2 className="group-title">雲端備份</h2>
      <div className="group" data-testid="cloud-group">
        {!ready && <p className="row note" id="cloud-need-config">請先在上方「背景提醒」填好伺服器網址與密碼。</p>}
        {!state ? (
          <>
            <p className="row note">開啟後，資料會加密後自動備份到你的伺服器，換手機時用還原碼取回。</p>
            <div className="row buttons">
              <button type="button" className="btn-outline" id="cloud-enable" disabled={busy || !ready} onClick={() => setPanel({ kind: 'code', code: generateCode(), mode: 'enable' })}>
                開啟雲端備份
              </button>
              <button type="button" className="btn-outline" id="cloud-restore" disabled={busy || !ready} onClick={() => setPanel({ kind: 'restore' })}>
                從雲端還原
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="row">
              <span>狀態</span>
              <span className={'value' + (status!.bad ? ' bad' : '')} id="cloud-status" role="status">{status!.text}</span>
            </div>
            <div className="row buttons">
              <button type="button" className="btn-outline" id="cloud-now" disabled={busy || !ready} onClick={() => run(actions.backupNow)}>
                立即備份
              </button>
              <button type="button" className="btn-outline" id="cloud-show" disabled={busy} onClick={() => setPanel({ kind: 'code', code: state.code, mode: 'show' })}>
                顯示還原碼
              </button>
            </div>
            <div className="row buttons">
              <button type="button" className="btn-outline" id="cloud-restore" disabled={busy || !ready} onClick={() => setPanel({ kind: 'restore' })}>
                從雲端還原
              </button>
              <button type="button" className="btn-outline" id="cloud-rotate" disabled={busy || !ready} onClick={() => setPanel({ kind: 'rotate-ask' })}>
                更換還原碼
              </button>
            </div>
            <div className="row buttons">
              <button type="button" className="btn-outline" id="cloud-disable" disabled={busy} onClick={() => setPanel({ kind: 'disable' })}>
                關閉雲端備份
              </button>
            </div>
          </>
        )}
        {message && <p className="row note" id="cloud-message" role="status">{message}</p>}
        {state && <p className="row note" id="cloud-one-phone">{ONE_PHONE_NOTE}</p>}
        <p className="row note">內容在手機上用還原碼加密後才送出，伺服器只存加密後的資料，看不到內容。最近 7 天每天保留一份。</p>
      </div>

      {p.shown?.kind === 'code' && (
        <CodeSheet
          code={p.shown.code}
          mode={p.shown.mode}
          closing={p.closing}
          busy={busy}
          onClose={() => setPanel(null)}
          onSaved={() => {
            const cur = p.shown as Extract<Panel, { kind: 'code' }>;
            setPanel(null);
            void run(() => (cur.mode === 'enable' ? actions.enable(cur.code) : actions.rotate(cur.code)));
          }}
        />
      )}

      {p.shown?.kind === 'rotate-ask' && (
        <Sheet closing={p.closing} onClose={() => setPanel(null)} labelledBy="rot-title" scrimLabel="關閉">
          <h2 id="rot-title" className="sheet-title">更換還原碼？</h2>
          <p className="del-text">會產生一組新的還原碼，並用新碼重新備份、刪掉雲端上舊碼的備份。舊的還原碼之後就不能用了。</p>
          <div className="del-actions">
            <button type="button" className="btn-ghost" id="cloud-rotate-go" onClick={() => setPanel({ kind: 'code', code: generateCode(), mode: 'rotate' })}>
              產生新還原碼
            </button>
            <button type="button" className="btn-text" onClick={() => setPanel(null)}>取消</button>
          </div>
        </Sheet>
      )}

      {p.shown?.kind === 'disable' && (
        <Sheet closing={p.closing} onClose={() => setPanel(null)} labelledBy="dis-title" scrimLabel="關閉">
          <h2 id="dis-title" className="sheet-title">關閉雲端備份</h2>
          <p className="del-text">要不要同時刪掉雲端上的備份？刪掉之後，這組還原碼就取不回資料了。</p>
          <div className="del-actions">
            <button type="button" className="btn-ghost" id="cloud-disable-delete" onClick={() => { setPanel(null); void run(() => actions.disable(true)); }}>
              關閉並刪除雲端備份
            </button>
            <button type="button" className="btn-ghost" id="cloud-disable-keep" onClick={() => { setPanel(null); void run(() => actions.disable(false)); }}>
              只關閉，保留雲端備份
            </button>
            <button type="button" className="btn-text" onClick={() => setPanel(null)}>取消</button>
          </div>
        </Sheet>
      )}

      {p.shown?.kind === 'restore' && (
        <RestoreSheet
          closing={p.closing}
          initialCode={state ? formatCode(state.code) : ''}
          liveCount={liveCount}
          actions={actions}
          onClose={() => setPanel(null)}
          onDone={(text) => {
            setPanel(null);
            setMessage(text);
          }}
        />
      )}
    </section>
  );
}

function CodeSheet({ code, mode, closing, busy, onClose, onSaved }: { code: string; mode: 'enable' | 'rotate' | 'show'; closing: boolean; busy: boolean; onClose: () => void; onSaved: () => void }) {
  const [copied, setCopied] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatCode(code));
      setCopied('已複製');
    } catch {
      setCopied('無法自動複製，請長按還原碼選取後複製');
    }
  };
  return (
    <Sheet closing={closing} onClose={onClose} labelledBy="code-title" scrimLabel="關閉">
      <h2 id="code-title" className="sheet-title">{mode === 'show' ? '你的還原碼' : mode === 'rotate' ? '新的還原碼' : '請先存好還原碼'}</h2>
      <p className="recovery-code" id="recovery-code" data-code={code}>{formatCode(code)}</p>
      <div className="code-copy">
        <button type="button" className="btn-outline" id="code-copy" onClick={copy}>複製</button>
        {copied && <span className="field-hint" role="status">{copied}</span>}
      </div>
      <p className="del-text">請把還原碼存到密碼管理器或 iCloud 備忘錄。忘記還原碼，雲端備份就無法取回。</p>
      {mode === 'show' ? (
        <div className="del-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>關閉</button>
        </div>
      ) : (
        <div className="del-actions">
          <button type="button" className="btn-primary" id="code-saved" disabled={busy} onClick={onSaved}>我已存好</button>
          <button type="button" className="btn-text" onClick={onClose}>取消</button>
        </div>
      )}
    </Sheet>
  );
}

const MODES: { mode: RestoreMode; label: string; hint: string }[] = [
  { mode: 'merge', label: '合併', hint: '保留這支手機上較新的修改，只補回手機上沒有的。換新手機時用這個。' },
  { mode: 'revert', label: '回到那一天', hint: '把備份裡的每一筆換回那天的樣子：之後刪掉的會回來、之後改的會換回去；那天之後才新增的會保留。' },
];

function RestoreSheet({ closing, initialCode, liveCount, actions, onClose, onDone }: { closing: boolean; initialCode: string; liveCount: number; actions: CloudActions; onClose: () => void; onDone: (text: string) => void }) {
  const [input, setInput] = useState(initialCode);
  const [found, setFound] = useState<{ code: string; items: RemoteItem[] } | null>(null);
  const [day, setDay] = useState('');
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** 「回到那一天」完成後：留在面板上顯示結果與「復原這次還原」，面板關閉就消失 */
  const [result, setResult] = useState<{ text: string; inverse?: Changes } | null>(null);

  const lookup = async () => {
    setBusy(true);
    setError('');
    setFound(null);
    setConfirming(false);
    try {
      const r = await actions.lookup(input);
      setFound(r);
      setDay(r.items[0].day);
      setMode('merge');
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : '查詢失敗，請稍後再試。');
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!found) return;
    setBusy(true);
    const r = await actions.restoreWithUndo(found.code, day, mode);
    setBusy(false);
    if (mode === 'revert') setResult(r);
    else onDone(r.text);
  };

  const undo = async () => {
    if (!result?.inverse) return;
    setBusy(true);
    const text = await actions.undoRestore(result.inverse);
    setBusy(false);
    setResult({ text });
  };

  const close = () => (result ? onDone(result.text) : onClose());

  return (
    <Sheet closing={closing} onClose={close} labelledBy="rs-title" scrimLabel="關閉">
      <h2 id="rs-title" className="sheet-title">從雲端還原</h2>
      {result ? (
        <>
          <p className="del-text" id="restore-result" role="status">{result.text}</p>
          <div className="del-actions">
            {result.inverse && (
              <button type="button" className="btn-ghost" id="restore-undo" disabled={busy} onClick={undo}>復原這次還原</button>
            )}
            <button type="button" className="btn-primary" id="restore-done" onClick={close}>完成</button>
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label className="field-label" htmlFor="restore-code">還原碼</label>
            <input
              id="restore-code"
              className="text-input code-input"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setFound(null);
                setError('');
                setConfirming(false);
              }}
            />
          </div>
          {error && <p className="lead-warn" id="restore-error" role="alert">{error}</p>}
          {!found && (
            <div className="del-actions">
              <button type="button" className="btn-primary" id="restore-lookup" disabled={busy || input.trim() === ''} onClick={lookup}>查詢</button>
              <button type="button" className="btn-text" onClick={onClose}>取消</button>
            </div>
          )}
          {found && !confirming && (
            <>
              <div className="field">
                <span className="field-label" id="rs-days">選擇要還原的備份</span>
                <div className="restore-list" role="radiogroup" aria-labelledby="rs-days">
                  {found.items.map((it) => (
                    <button key={it.day} type="button" role="radio" aria-checked={day === it.day} className="restore-item" data-day={it.day} onClick={() => setDay(it.day)}>
                      {restoreItemText(it.day, it.updatedAt)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label" id="rs-mode">還原方式</span>
                <div className="restore-list restore-modes" role="radiogroup" aria-labelledby="rs-mode">
                  {MODES.map((m) => (
                    <button key={m.mode} type="button" role="radio" aria-checked={mode === m.mode} className="restore-item restore-mode" data-mode={m.mode} onClick={() => setMode(m.mode)}>
                      <span className="restore-mode-label">{m.label}</span>
                      <span className="restore-mode-hint">{m.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="del-actions">
                <button type="button" className="btn-primary" id="restore-go" disabled={busy} onClick={() => (mode === 'revert' || liveCount > 0 ? setConfirming(true) : void restore())}>還原</button>
                <button type="button" className="btn-text" onClick={onClose}>取消</button>
              </div>
            </>
          )}
          {found && confirming && (
            <>
              <p className="del-text" id="restore-confirm">
                {mode === 'revert' ? revertConfirmText(day) : `這支手機已有 ${liveCount} 筆資料。還原會合併進來，不會刪除現有資料；同一筆以較新的修改為準。`}
              </p>
              <div className="del-actions">
                <button type="button" className="btn-primary" id="restore-confirm-go" disabled={busy} onClick={restore}>{mode === 'revert' ? '回到那一天' : '確定還原'}</button>
                <button type="button" className="btn-text" onClick={() => setConfirming(false)}>返回</button>
              </div>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
