import { useEffect, useState } from 'react';
import { quickDates, type EditorForm, type TimeMode } from '../lib/editor';
import { CATEGORIES, LEAD_OPTIONS, type Category } from '../types';
import { repeatHint } from '../lib/repeat';
import { usePresence } from '../lib/usePresence';
import { CalendarSheet } from './CalendarSheet';
import { TimeWheel } from './TimeWheel';
import { Sheet } from './Sheet';

interface Props {
  form: EditorForm;
  closing: boolean;
  today: string;
  defaultLead: number; // 設定裡的預設提前分鐘
  onChange: (patch: Partial<EditorForm>) => void;
  onCancel: () => void;
  onSave: () => void;
}

const TIME_CHIPS: [TimeMode, string][] = [['', '不設'], ['上午', '上午'], ['下午', '下午'], ['pick', '指定']];

export function EditSheet({ form, closing, today, defaultLead, onChange, onCancel, onSave }: Props) {
  const quick = quickDates(today);
  const isQuick = quick.includes(form.date);
  const [shake, setShake] = useState(false);
  const [leadNotice, setLeadNotice] = useState(false); // 剛改成獨立通知時間時跳出的說明框
  const [picking, setPicking] = useState<'date' | 'until' | null>(null); // 正在用月曆選哪一個日期
  const pickP = usePresence(picking, 300);
  const canSave = form.title.trim().length > 0;
  const isNew = form.mode === 'new';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !picking) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, picking]);

  return (
    <>
    <Sheet closing={closing} onClose={onCancel} labelledBy="sheet-title" scrimLabel="關閉">
        <h2 id="sheet-title" className="sheet-title">{isNew ? '新增事項' : '編輯事項'}</h2>

        <div className="field">
          <label htmlFor="ed-title" className="field-label">事項</label>
          <input
            id="ed-title"
            className="text-input"
            value={form.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="例如：與設計組對稿"
          />
        </div>

        <div className="field" role="group" aria-labelledby="ed-date-l">
          <span id="ed-date-l" className="field-label">日期</span>
          <div className="chips">
            {(['今天', '明天', '後天'] as const).map((label, i) => (
              <button key={label} type="button" className="chip" aria-pressed={form.date === quick[i]} onClick={() => onChange({ date: quick[i] })}>
                {label}
              </button>
            ))}
            <button
              type="button"
              className={'chip date-chip' + (!isQuick ? ' on' : '')}
              aria-label="用月曆選日期"
              onClick={() => setPicking('date')}
            >
              {isQuick ? '選日期' : form.date.replace(/-/g, '.')}
            </button>
          </div>
        </div>

        <div className="field" role="group" aria-labelledby="ed-time-l">
          <span id="ed-time-l" className="field-label">時間</span>
          <div className="chips">
            {TIME_CHIPS.map(([v, label]) => (
              <button key={label} type="button" className="chip" aria-pressed={form.timeMode === v} onClick={() => onChange({ timeMode: v })}>
                {label}
              </button>
            ))}
          </div>
          {form.timeMode === 'pick' && (
            <TimeWheel value={form.timeVal} onChange={(timeVal) => onChange({ timeVal })} />
          )}
          {form.timeMode === 'pick' && (
            <div className="lead-row" role="group" aria-label="提前提醒（分鐘）">
              <span className="lead-label">提前提醒（分鐘）</span>
              <div className="chips">
                {LEAD_OPTIONS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="chip"
                    aria-pressed={(form.lead ?? defaultLead) === m}
                    onClick={() => {
                      onChange({ lead: m });
                      setLeadNotice(true);
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {form.lead !== null && <p className="lead-warn">獨立通知時間，未跟隨預設通知時間。</p>}
              {leadNotice && form.lead !== null && (
                <div className="lead-notice" role="status">
                  已獨立設定通知時間，若要恢復跟隨預設通知時間，請點擊「恢復預設通知時間」。
                </div>
              )}
              <button
                type="button"
                className="btn-outline lead-reset"
                disabled={form.lead === null}
                onClick={() => {
                  onChange({ lead: null });
                  setLeadNotice(false);
                }}
              >
                恢復預設通知時間（{defaultLead} 分鐘）
              </button>
            </div>
          )}
        </div>

        <div className="field" role="group" aria-labelledby="ed-cat-l">
          <span id="ed-cat-l" className="field-label">分類</span>
          <div className="chips">
            {CATEGORIES.map((c: Category) => (
              <button key={c} type="button" className="chip" aria-pressed={form.category === c} onClick={() => onChange({ category: c })}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="field" role="group" aria-labelledby="ed-rep-l">
          <span id="ed-rep-l" className="field-label">重複</span>
          <div className="chips">
            {([['none', '不重複'], ['weekly', '每週'], ['monthly', '每月']] as const).map(([v, label]) => (
              <button key={v} type="button" className="chip" aria-pressed={form.repeat === v} onClick={() => onChange({ repeat: v })}>
                {label}
              </button>
            ))}
          </div>
          {form.repeat !== 'none' && (
            <>
              <div className="chips">
                <button type="button" className="chip" aria-pressed={form.until === ''} onClick={() => onChange({ until: '' })}>
                  不結束
                </button>
                <button
                  type="button"
                  className={'chip date-chip' + (form.until !== '' ? ' on' : '')}
                  aria-label="選結束日期"
                  onClick={() => setPicking('until')}
                >
                  {form.until ? form.until.replace(/-/g, '.') : '選結束日'}
                </button>
              </div>
              <p className="field-hint">
                {repeatHint(form.repeat, form.date)}
                {form.until ? `，到 ${form.until.replace(/-/g, '.')} 為止` : ''}
              </p>
            </>
          )}
        </div>

        <div className="sheet-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>取消</button>
          <button
            type="button"
            className={'btn-primary' + (shake ? ' shake' : '')}
            aria-disabled={!canSave}
            onAnimationEnd={() => setShake(false)}
            onClick={() => {
              if (canSave) return onSave();
              setShake(false);
              requestAnimationFrame(() => setShake(true));
              document.getElementById('ed-title')?.focus();
            }}
          >
            {isNew ? '記下' : '儲存'}
          </button>
        </div>
    </Sheet>
    {pickP.shown && (
      <CalendarSheet
        day={pickP.shown === 'date' ? form.date : form.until || form.date}
        closing={pickP.closing}
        today={today}
        minDate={pickP.shown === 'until' ? form.date : undefined}
        todayLabel="今天"
        onPick={(iso) => {
          onChange(pickP.shown === 'date' ? { date: iso } : { until: iso });
          setPicking(null);
        }}
        onToday={() => {
          onChange(pickP.shown === 'date' ? { date: today } : { until: today < form.date ? form.date : today });
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    )}
    </>
  );
}
