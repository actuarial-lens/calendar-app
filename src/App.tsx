import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banner } from './components/Banner';
import { CalendarSheet } from './components/CalendarSheet';
import { EditSheet } from './components/EditSheet';
import { RepeatDeleteSheet } from './components/RepeatDeleteSheet';
import { CalendarIcon, GearIcon, PlusIcon } from './components/Icons';
import { MissedBlock } from './components/MissedBlock';
import { Notes } from './components/Notes';
import { SettingsPage } from './components/SettingsPage';
import type { SwipeAction } from './components/SwipeRow';
import { TagBar } from './components/TagBar';
import { TaskCard } from './components/TaskCard';
import { Toast } from './components/Toast';
import { WeekStrip } from './components/WeekStrip';
import { commit } from './db/changes';
import { testPushServer } from './notify/push';
import { backupFileName, buildBackup, importSummary, parseBackup, planImport } from './lib/backup';
import { db } from './db/db';
import { addNote, ensureRepeats } from './db/maintenance';
import { loadSettings, saveSettings } from './db/settings';
import { useLive } from './db/useLive';
import * as A from './lib/actions';
import { deleteSeries, withRepeats } from './lib/repeat';
import type { Action, Changes } from './lib/changes';
import { useAnimatedList } from './lib/animatedList';
import { addDays, rangeText, weekDates } from './lib/dates';
import { formFromTask, newForm, type EditorForm } from './lib/editor';
import { newId } from './lib/id';
import type { Reminder } from './lib/reminders';
import { hasContent, visibleNotes, visibleTasks } from './lib/sort';
import { isISODate } from './lib/swLogic';
import { usePresence } from './lib/usePresence';
import { useToday } from './lib/useToday';
import { enableNotifications, sendTestNotification } from './notify/enable';
import { useReminders } from './notify/useReminders';
import type { Note, Tag, Task } from './types';

const BLUE = '#2E4A6B';
const GREY = '#6F6A60';
const RED = '#A4554B';
const TOAST_MS = 4000;

interface AppProps {
  initialMissed?: Reminder[];
  initialDay?: string;
}

export default function App({ initialMissed = [], initialDay }: AppProps) {
  const tasks = useLive(() => db.tasks.toArray());
  const notes = useLive(() => db.notes.toArray());
  const settings = useLive(() => loadSettings(db));
  const today = useToday();
  const [day, setDay] = useState(initialDay ?? today);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [missed, setMissed] = useState<Reminder[]>(initialMissed);
  const [banner, setBanner] = useState<Reminder | null>(null);
  const [tag, setTag] = useState<Tag>('全部');
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<EditorForm | null>(null);
  const [calOpen, setCalOpen] = useState(false);
  const [delAsk, setDelAsk] = useState<Task | null>(null); // 要刪除的是重複事項，等著問「這一次還是全部」
  const [toast, setToast] = useState<{ text: string; undo: Changes } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 跨日（或回到前景發現已經過了午夜）：原本停在「今天」的就跟著換到新的一天
  const prevToday = useRef(today);
  useEffect(() => {
    const prev = prevToday.current;
    prevToday.current = today;
    if (prev !== today) setDay((d) => (d === prev ? today : d));
  }, [today]);

  // 補排重複事項；沒有需要補的時候不會寫入，所以不會一直循環
  useEffect(() => {
    if (tasks) void ensureRepeats(db, today);
  }, [tasks, today]);

  useReminders({
    tasks,
    settings,
    onLive: setBanner,
    onMissed: (list) => setMissed((cur) => [...cur, ...list.filter((r) => !cur.some((c) => c.id === r.id))]),
  });

  // 點系統通知時，如果 App 已經開著，Service Worker 會通知我們跳到那一天
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'open-date' && isISODate(e.data.date)) {
        setDay(e.data.date);
        setSettingsOpen(false);
        setCalOpen(false);
        setForm(null);
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, []);

  // 讓面板、提示「消失」時也有動畫
  const formP = usePresence(form);
  const delP = usePresence(delAsk);
  const calP = usePresence(calOpen ? true : null);
  const settingsP = usePresence(settingsOpen ? true : null, 340);
  const toastP = usePresence(toast, 240);
  const bannerP = usePresence(banner, 240);
  const missedP = usePresence(missed.length > 0 ? missed : null, 240);
  const closeBanner = useCallback(() => setBanner(null), []);

  // 事項、隨手記增減時的展開／收合動畫；換日期或分類時不做動畫
  const ready = !!tasks && !!notes;
  const listKey = day + '|' + tag;
  const taskEntries = useAnimatedList(tasks ? visibleTasks(tasks, day, tag) : [], listKey, ready);
  const noteEntries = useAnimatedList(notes ? visibleNotes(notes, day) : [], day, ready);

  const marks = useMemo(() => {
    const s = new Set<string>();
    if (tasks && notes) for (const iso of weekDates(day)) if (hasContent(iso, tasks, notes)) s.add(iso);
    return s;
  }, [tasks, notes, day]);

  if (!tasks || !notes || !settings) return <div className="app" />;

  const showToast = (text: string, undo: Changes) => {
    clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  /** 執行一個動作，並出現可以復原的提示（一次只保留最近一個） */
  const run = async (a: Action) => {
    setOpenId(null);
    const undo = await commit(db, withRepeats(a, tasks, today, Date.now(), newId).changes);
    showToast(a.message, undo);
  };

  const undo = async () => {
    if (!toast) return;
    clearTimeout(toastTimer.current);
    const inverse = toast.undo;
    setToast(null);
    setOpenId(null);
    await commit(db, inverse);
  };

  /** 匯出：產生 JSON 檔，能分享就開分享表單（可存到「檔案」），否則下載 */
  const exportBackup = async (): Promise<string> => {
    const [allT, allN] = await Promise.all([db.tasks.toArray(), db.notes.toArray()]);
    const backup = buildBackup(allT, allN, Date.now());
    const file = new File([JSON.stringify(backup, null, 2)], backupFileName(today), { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return `已匯出 ${backup.tasks.length} 筆事項、${backup.notes.length} 則備忘。`;
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return '已取消匯出。';
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return `已匯出 ${backup.tasks.length} 筆事項、${backup.notes.length} 則備忘。`;
  };

  /** 匯入：檢查格式 → 合併（較新的留下、不刪除任何現有資料） */
  const importBackup = async (f: File): Promise<string> => {
    const parsed = parseBackup(await f.text());
    if (!parsed.ok) return parsed.error;
    const [allT, allN] = await Promise.all([db.tasks.toArray(), db.notes.toArray()]);
    const plan = planImport(parsed.backup, allT, allN);
    await commit(db, plan.changes);
    return importSummary(plan, parsed.skipped);
  };

  /** 重複事項要先問；一般事項直接刪 */
  const askDelete = (t: Task) => {
    if (!t.repeat) return void run(A.deleteTask(t, Date.now()));
    setOpenId(null);
    setDelAsk(t);
  };

  const taskActions = (t: Task): SwipeAction[] =>
    t.done
      ? [
          { label: '恢復', color: BLUE, run: () => run(A.restoreTask(t, Date.now())) },
          { label: '刪除', color: RED, run: () => askDelete(t) },
        ]
      : [
          { label: '完成', color: BLUE, run: () => run(A.completeTask(t, Date.now())) },
          { label: '延後', color: GREY, run: () => run(A.delayTask(t, Date.now())) },
          { label: '刪除', color: RED, run: () => askDelete(t) },
        ];

  const noteActions = (n: Note): SwipeAction[] => [
    { label: '轉待辦', color: BLUE, run: () => run(A.noteToTask(n, Date.now(), newId())) },
    { label: '延後', color: GREY, run: () => run(A.delayNote(n, Date.now())) },
    { label: '刪除', color: RED, run: () => run(A.deleteNote(n, Date.now())) },
  ];

  const save = () => {
    if (!form) return;
    const existing = form.id ? tasks.find((t) => t.id === form.id) : undefined;
    const action = A.saveForm(form, existing, Date.now(), newId(), tasks, newId());
    if (!action) return;
    setForm(null);
    void run(action);
  };

  const pickDay = (iso: string) => {
    setDay(iso);
    setOpenId(null);
  };

  const nothingShown = taskEntries.every((e) => e.phase === 'exit');

  return (
    <div
      className="app"
      // 點到打開的那一列以外的地方，就收合
      onPointerDownCapture={(e) => {
        if (!openId) return;
        const inside = (e.target as HTMLElement).closest(`[data-swipe-id="${CSS.escape(openId.replace(/>$/, ''))}"]`);
        if (!inside) setOpenId(null);
      }}
    >
      <header className="header">
        <button type="button" className="gear" aria-label="設定" onClick={() => { setOpenId(null); setSettingsOpen(true); }}>
          <GearIcon />
        </button>
        <button type="button" className="range" aria-label="回到今天" onClick={() => pickDay(today)}>{rangeText(day)}</button>
      </header>

      {missedP.shown && <MissedBlock items={missedP.shown} closing={missedP.closing} today={today} onClose={() => setMissed([])} />}
      <WeekStrip day={day} marks={marks} onPick={pickDay} onShiftWeek={(dir) => pickDay(addDays(day, dir * 7))} />
      <TagBar tag={tag} onPick={(t) => { setTag(t); setOpenId(null); }} />

      <main className="main">
        <div className="task-list fade-in" key={listKey}>
          {taskEntries.map(({ item: t, phase }) => (
            <TaskCard
              key={t.id}
              task={t}
              phase={phase}
              open={openId === t.id}
              anyOpen={openId !== null}
              actions={taskActions(t)}
              startActions={!t.done && t.delayDays > 0 ? [{ label: '恢復', color: BLUE, run: () => run(A.undelayTask(t, Date.now())) }] : undefined}
              openKey={openId}
              onOpenChange={setOpenId}
              onEdit={() => setForm(formFromTask(t))}
            />
          ))}
        </div>
        {nothingShown && <p className="empty">這天這類沒有安排，留點空白也很好。</p>}
        <Notes
          entries={noteEntries}
          resetKey={day}
          openId={openId}
          actionsFor={noteActions}
          onOpenChange={setOpenId}
          onAdd={(text) => addNote(db, day, text)}
        />
      </main>

      <div className="bottom">
        <button type="button" className="btn-new" onClick={() => { setOpenId(null); setForm(newForm(day)); }}>
          <PlusIcon />
          新增事項
        </button>
        <button type="button" className="btn-cal" aria-label="月曆檢視" onClick={() => { setOpenId(null); setCalOpen(true); }}>
          <CalendarIcon />
        </button>
      </div>

      {bannerP.shown && <Banner reminder={bannerP.shown} closing={bannerP.closing} onClose={closeBanner} />}

      {settingsP.shown && (
        <SettingsPage
          settings={settings}
          closing={settingsP.closing}
          onChange={(patch) => void saveSettings(db, patch)}
          onEnable={() => enableNotifications(db)}
          onTest={sendTestNotification}
          onTestPush={() => testPushServer(settings)}
          onExport={exportBackup}
          onImport={importBackup}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {toastP.shown && <Toast text={toastP.shown.text} closing={toastP.closing} onUndo={undo} />}

      {delP.shown && (
        <RepeatDeleteSheet
          task={delP.shown}
          closing={delP.closing}
          onCancel={() => setDelAsk(null)}
          onOne={() => {
            const t = delP.shown!;
            setDelAsk(null);
            void run(A.deleteTask(t, Date.now()));
          }}
          onAll={() => {
            const t = delP.shown!;
            setDelAsk(null);
            void run(deleteSeries(tasks, t, Date.now()));
          }}
        />
      )}

      {formP.shown && (
        <EditSheet
          form={formP.shown}
          closing={formP.closing}
          today={today}
          onChange={(patch) => setForm((f) => (f ? { ...f, ...patch } : f))}
          onCancel={() => setForm(null)}
          onSave={save}
        />
      )}

      {calP.shown && (
        <CalendarSheet
          day={day}
          closing={calP.closing}
          today={today}
          marks={(iso) => hasContent(iso, tasks, notes)}
          onPick={(iso) => { pickDay(iso); setCalOpen(false); }}
          onToday={() => { pickDay(today); setCalOpen(false); }}
          onClose={() => setCalOpen(false)}
        />
      )}
    </div>
  );
}
