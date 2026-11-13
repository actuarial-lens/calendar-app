import type { Category, Task, TimeValue } from '../types';
import type { RepeatFreq } from '../types';
import { addDays } from './dates';

export type TimeMode = '' | '上午' | '下午' | 'pick';

export interface EditorForm {
  mode: 'new' | 'edit';
  id: string | null;
  title: string;
  date: string;
  category: Category;
  timeMode: TimeMode;
  timeVal: string; // 'HH:mm'，只在 timeMode === 'pick' 時使用
  repeat: 'none' | RepeatFreq;
  until: string; // 重複的結束日期，'' = 不結束
  lead: number | null; // 這一件事自己的提前分鐘；null = 用預設
  important: boolean;
  /** 重複事項切換「重要」時選的範圍：'one' 僅限這次、'future' 未來每一次（這一筆和之後還沒完成的） */
  importantScope: ImportantScope;
  deadline: boolean;
  deadlineScope: ImportantScope; // 同上，切換「截止日」時選的範圍
  /** 重複事項改了標題／時間／分類／提前提醒，存檔時選的範圍（日期一律只改這一筆） */
  editScope: ImportantScope;
}

export type ImportantScope = 'one' | 'future';

const HM = /^\d{1,2}:\d{2}$/;
export const DEFAULT_PICK_TIME = '09:00';

/** 新增：空白，日期預設為目前看的那天，分類預設待辦 */
export function newForm(day: string): EditorForm {
  return { mode: 'new', id: null, title: '', date: day, category: '待辦', timeMode: '', timeVal: DEFAULT_PICK_TIME, repeat: 'none', until: '', lead: null, important: false, importantScope: 'one', deadline: false, deadlineScope: 'one', editScope: 'one' };
}

/** 編輯：帶入原本的內容 */
export function formFromTask(t: Task): EditorForm {
  const isHM = HM.test(t.time);
  return {
    mode: 'edit',
    id: t.id,
    title: t.title,
    date: t.date,
    category: t.category,
    timeMode: isHM ? 'pick' : (t.time as TimeMode),
    timeVal: isHM ? t.time : DEFAULT_PICK_TIME,
    repeat: t.repeat ? t.repeat.freq : 'none',
    until: t.repeat?.until ?? '',
    lead: t.leadMinutes ?? null,
    important: !!t.important,
    importantScope: 'one',
    deadline: !!t.deadline,
    deadlineScope: 'one',
    editScope: 'one',
  };
}

/** 表單的時間欄位 → Task.time */
export function formTime(f: EditorForm): TimeValue {
  if (f.timeMode === 'pick') return f.timeVal && HM.test(f.timeVal) ? (f.timeVal as TimeValue) : '';
  return f.timeMode;
}

/** 今天／明天／後天三顆的日期 */
export function quickDates(today: string): [string, string, string] {
  return [today, addDays(today, 1), addDays(today, 2)];
}
