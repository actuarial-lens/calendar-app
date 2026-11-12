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
}

const HM = /^\d{1,2}:\d{2}$/;
export const DEFAULT_PICK_TIME = '09:00';

/** 新增：空白，日期預設為目前看的那天，分類預設待辦 */
export function newForm(day: string): EditorForm {
  return { mode: 'new', id: null, title: '', date: day, category: '待辦', timeMode: '', timeVal: DEFAULT_PICK_TIME, repeat: 'none', until: '' };
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
