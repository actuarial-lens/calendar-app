import type { NotificationProvider, SyncContext, SyncReason } from './types';

/** 把同步動作交給每一種通知實作。沒設定好的略過；其中一個出錯，不影響另一個。 */
export class NotificationManager {
  private chain: Promise<void> = Promise.resolve();

  constructor(private providers: NotificationProvider[]) {}

  /** 一次只跑一個同步，避免同一個提醒被重複發送 */
  sync(ctx: SyncContext, reason: SyncReason): Promise<void> {
    this.chain = this.chain.then(() => this.run(ctx, reason));
    return this.chain;
  }

  private async run(ctx: SyncContext, reason: SyncReason): Promise<void> {
    for (const p of this.providers) {
      try {
        if (!p.isConfigured(ctx.settings)) continue;
        await p.sync(ctx, reason);
      } catch (e) {
        console.warn(`[通知] ${p.name} 同步失敗`, e);
      }
    }
  }
}
