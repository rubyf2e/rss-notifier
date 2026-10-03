import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationService } from '../mail/notification.service';
import { FeedSyncService } from './feed-sync.service';

const DEFAULT_INTERVAL_MINUTES = 15;

@Injectable()
export class FeedSyncScheduler {
  private readonly logger = new Logger(FeedSyncScheduler.name);
  private lastRunAt: number | null = null;
  private isRunning = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly feedSyncService: FeedSyncService,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async syncIfDue(): Promise<boolean> {
    const intervalValue = Number(this.configService.get<string>('FEED_SYNC_INTERVAL_MINUTES'));
    const intervalMinutes = Number.isFinite(intervalValue) && intervalValue > 0
      ? intervalValue
      : DEFAULT_INTERVAL_MINUTES;
    const now = Date.now();

    if (
      this.isRunning ||
      (this.lastRunAt !== null && now - this.lastRunAt < intervalMinutes * 60_000)
    ) {
      return false;
    }

    this.lastRunAt = now;
    this.isRunning = true;
    try {
      try {
        await this.feedSyncService.syncSubscribedFeeds();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Feed 同步排程失敗：${message}`);
      }
      try {
        await this.notificationService.enqueuePendingNotifications();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`通知排程失敗：${message}`);
      }
    } finally {
      this.isRunning = false;
    }
    return true;
  }
}