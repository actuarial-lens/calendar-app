export type Category = '會議' | '待辦' | '私人';
export type Tag = '全部' | Category | '已完成';
/** '' = 不設時間；'上午'／'下午'；'HH:mm' = 指定時間 */
export type TimeValue = '' | '上午' | '下午' | `${string}:${string}`;

export type RepeatFreq = 'weekly' | 'monthly';

/** 重複事項：同一組（seriesId）的每一次都是獨立的一筆事項，各自完成、各自刪除 */
export interface Repeat {
  seriesId: string;
  freq: RepeatFreq;
  anchor: string; // 這組重複的起始日；每月重複用它的「幾號」
  occurrence: string; // 這一筆原本屬於哪一天（被延後、改日期都不會變）
  until?: string; // 結束日期（含當天）；沒有就是不結束
}

export interface Task {
  id: string;
  date: string; // 'YYYY-MM-DD'
  time: TimeValue;
  category: Category;
  title: string;
  note: string;
  done: boolean;
  doneAt?: number;
  delayDays: number; // 累計延後天數，> 0 時顯示「延 N 天」
  createdAt: number;
  updatedAt: number;
  deletedAt?: number; // 軟刪除，14 天後才真正清掉
  repeat?: Repeat;
}

export interface Note {
  id: string;
  date: string; // 每天獨立
  text: string;
  createdAt: number; // 顯示為 HH:mm
  updatedAt: number;
  deletedAt?: number;
}

export interface Settings {
  morningEnabled: boolean; // 每天早上的「今天有 N 件事」，預設開
  morningTime: string; // 預設 '08:30'
  leadMinutes: number; // 預設 10
  notificationsEnabled: boolean;
  push: { endpoint: string; vapidPublicKey: string; secret: string }; // 伺服器網址、公鑰、密碼；預設都是空字串
}

export const DEFAULT_SETTINGS: Settings = {
  morningEnabled: true,
  morningTime: '08:30',
  leadMinutes: 10,
  notificationsEnabled: false,
  push: { endpoint: '', vapidPublicKey: '', secret: '' },
};

export const CATEGORIES: Category[] = ['會議', '待辦', '私人'];
export const TAGS: Tag[] = ['全部', '會議', '待辦', '私人', '已完成'];
