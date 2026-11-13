import { describe, expect, it } from 'vitest';
import { undelayTask, saveForm } from './actions';
import { alertsEmpty, alertsSummary, buildAlerts, monthDay, moveAllToToday, muteOverdue } from './alerts';
import { BACKUP_FORMAT, parseBackup } from './backup';
import { formFromTask, newForm } from './editor';
import { applyToTasks, planRepeats } from './repeat';
import type { Task } from '../types';

let n = 0;
const nid = () => 'id' + ++n;
const NOW = 9000;
const TODAY = '2026-11-13';

const mk = (over: Partial<Task> = {}): Task => ({
  id: 'x' + ++n, date: TODAY, time: '10:00', category: '待辦', title: 't', note: '',
  done: false, delayDays: 0, createdAt: n, updatedAt: 1, ...over,
});
const ids = (ts: { id: string }[]) => ts.map((t) => t.id);

describe('過去的重要未結', () => {
  it('只算重要、今天之前、未完成、未刪除、沒按不再通知；依日期排', () => {
    const ts = [
      mk({ id: 'b', date: '2026-11-10', important: true }),
      mk({ id: 'a', date: '2026-11-01', important: true }),
      mk({ id: 'today', important: true }),
      mk({ id: 'plain', date: '2026-11-10' }),
      mk({ id: 'done', date: '2026-11-10', important: true, done: true }),
      mk({ id: 'del', date: '2026-11-10', important: true, deletedAt: 1 }),
      mk({ id: 'muted', date: '2026-11-10', important: true, muteOverdue: true }),
    ];
    expect(ids(buildAlerts(ts, TODAY).overdue)).toEqual(['a', 'b']);
  });
});

describe('截止日', () => {
  it('今天到 7 天後（含）的、加上已過期的；已過期只看日期', () => {
    const ts = [
      mk({ id: 'd7', date: '2026-11-20', deadline: true }),
      mk({ id: 'd8', date: '2026-11-21', deadline: true }),
      mk({ id: 'today', date: TODAY, time: '00:30', deadline: true }), // 當天過了時間還不算過期
      mk({ id: 'old', date: '2026-10-01', deadline: true }),
      mk({ id: 'plain', date: '2026-11-15' }),
      mk({ id: 'done', date: '2026-11-15', deadline: true, done: true }),
    ];
    const d = buildAlerts(ts, TODAY).deadlines;
    expect(d.map((x) => [x.task.id, x.expired])).toEqual([['old', true], ['today', false], ['d7', false]]);
  });

  it('同時重要＋截止且已過期：只列在重要未結；還沒過期的在截止那段', () => {
    const ts = [mk({ id: 'both-old', date: '2026-11-10', important: true, deadline: true }), mk({ id: 'both-soon', date: '2026-11-15', important: true, deadline: true })];
    const a = buildAlerts(ts, TODAY);
    expect(ids(a.overdue)).toEqual(['both-old']);
    expect(a.deadlines.map((x) => x.task.id)).toEqual(['both-soon']);
  });

  it('按過不再通知的，截止那段也不列', () => {
    const a = buildAlerts([mk({ date: '2026-11-10', important: true, deadline: true, muteOverdue: true })], TODAY);
    expect(alertsEmpty(a)).toBe(true);
  });
});

describe('摘要與日期', () => {
  it('只列有的部分', () => {
    const ts = [
      mk({ date: '2026-11-10', important: true }), mk({ date: '2026-11-11', important: true }),
      mk({ date: '2026-11-01', deadline: true }), mk({ date: '2026-11-14', deadline: true }), mk({ date: '2026-11-15', deadline: true }),
    ];
    expect(alertsSummary(buildAlerts(ts, TODAY))).toBe('過去 2 件重要未結 · 7 天內 2 件截止 · 1 件已過期');
    expect(alertsSummary(buildAlerts([mk({ date: '2026-11-14', deadline: true })], TODAY))).toBe('7 天內 1 件截止');
    expect(alertsEmpty(buildAlerts([mk()], TODAY))).toBe(true);
  });
  it('monthDay', () => {
    expect(monthDay('2026-01-05')).toBe('1月5日');
  });
});

describe('全部移至本日、不再通知', () => {
  it('日期改今天、時間不動、延後天數加上相差天數、拿掉手動順序；可用「恢復」回原日期', () => {
    const t = mk({ date: '2026-11-10', time: '15:00', important: true, delayDays: 1, order: 2 });
    const a = moveAllToToday([t], TODAY, NOW);
    const m = a.changes.putTasks[0];
    expect(m).toMatchObject({ date: TODAY, time: '15:00', delayDays: 4, updatedAt: NOW });
    expect('order' in m).toBe(false);
    expect(a.message).toBe('已將 1 件移至今天');
    expect(undelayTask(m, NOW).changes.putTasks[0].date).toBe('2026-11-09'); // 回到最早原定的日期（延後前）
    // 跨月
    const x = moveAllToToday([mk({ date: '2026-10-30' })], TODAY, NOW).changes.putTasks[0];
    expect(x.delayDays).toBe(14);
  });

  it('不再通知：清單上這幾筆記上記號，新的照樣列', () => {
    const a = mk({ date: '2026-11-10', important: true });
    const muted = muteOverdue([a], NOW).changes.putTasks;
    const later = mk({ date: '2026-11-12', important: true });
    const all = [...applyToTasks([a], { putTasks: muted, delTaskIds: [], putNotes: [], delNoteIds: [] }), later];
    expect(ids(buildAlerts(all, TODAY).overdue)).toEqual([later.id]);
  });
});

describe('截止日標記的儲存', () => {
  it('新增、編輯一般事項', () => {
    const t = saveForm({ ...newForm(TODAY), title: 'x', deadline: true }, undefined, NOW, 'n1')!.changes.putTasks[0];
    expect(t.deadline).toBe(true);
    expect(formFromTask(t)).toMatchObject({ deadline: true, deadlineScope: 'one' });
    const off = saveForm({ ...formFromTask(t), deadline: false }, t, NOW, 'z')!.changes.putTasks[0];
    expect('deadline' in off).toBe(false);
  });

  const rep = (occ: string) => ({ seriesId: 's1', freq: 'weekly' as const, anchor: '2026-11-13', occurrence: occ });
  const series = () => [
    mk({ id: 'a', date: '2026-11-13', repeat: rep('2026-11-13') }),
    mk({ id: 'b', date: '2026-11-20', repeat: rep('2026-11-20') }),
    mk({ id: 'c', date: '2026-11-27', done: true, repeat: rep('2026-11-27') }),
  ];

  it('重複事項「僅限這次」：只這一筆，之後新排的沒有', () => {
    const all = series();
    const put = saveForm({ ...formFromTask(all[1]), deadline: true, deadlineScope: 'one' }, all[1], NOW, 'z', all)!.changes.putTasks;
    expect(put).toHaveLength(1);
    expect(put[0].deadline).toBe(true);
    expect(put[0].repeat!.deadline).toBeUndefined();
    const more = planRepeats(applyToTasks(all, { putTasks: put, delTaskIds: [], putNotes: [], delNoteIds: [] }), TODAY, NOW, nid);
    expect(more.some((x) => x.deadline)).toBe(false);
  });

  it('重複事項「未來每一次」：這筆和之後還沒完成的都標，之後新排的也標', () => {
    const all = series();
    const put = saveForm({ ...formFromTask(all[0]), deadline: true, deadlineScope: 'future' }, all[0], NOW, 'z', all)!.changes.putTasks;
    const m = new Map(put.map((t) => [t.id, t]));
    expect(m.get('a')!.deadline).toBe(true);
    expect(m.get('b')!.deadline).toBe(true);
    expect(m.get('c')!.deadline).toBeUndefined(); // 已完成的卡片不動
    expect(m.get('c')!.repeat!.deadline).toBe(true);
    const more = planRepeats(applyToTasks(all, { putTasks: put, delTaskIds: [], putNotes: [], delNoteIds: [] }), TODAY, NOW, nid);
    expect(more.length).toBeGreaterThan(0);
    expect(more.every((x) => x.deadline)).toBe(true);
  });

  it('新增重複事項標截止日：整組都標', () => {
    const t = saveForm({ ...newForm(TODAY), title: 'x', repeat: 'monthly', deadline: true }, undefined, NOW, 'n1', [], 's9')!.changes.putTasks[0];
    expect(t.repeat!.deadline).toBe(true);
    expect(planRepeats([t], TODAY, NOW, nid).every((x) => x.deadline)).toBe(true);
  });

  it('匯入：deadline／muteOverdue 不是布林的略過', () => {
    const ok = mk({ deadline: true, muteOverdue: true });
    const bad = mk({ deadline: 'yes' as never });
    const r = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: 1, tasks: [ok, bad], notes: [] }));
    expect(r.ok && r.backup.tasks.map((t) => t.id)).toEqual([ok.id]);
  });
});
