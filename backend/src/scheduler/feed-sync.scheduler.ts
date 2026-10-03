import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { NotificationService } from '../mail/notification.service';
import { FeedSyncService, FeedSyncSummary } from '../feeds/feed-sync.service';
import {
  PersistentSchedulerLogger,
  SchedulerRunLog,
} from './persistent-scheduler-logger.service';

const DEFAULT_INTERVAL_MINUTES = 15;

function classifyError(error: unknown): string {
  if (error instanceof Error) {
    return 'Error';
  }
  return 'Unknown';
}

@Injectable()
export class FeedSyncScheduler {
  private readonly logger = new Logger(FeedSyncScheduler.name);
  private lastRunAt: number | null = null;
  private isRunning = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly feedSyncService: FeedSyncService,
    private readonly notificationService: NotificationService,
    private readonly schedulerLogger: PersistentSchedulerLogger,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async syncIfDue(): Promise<boolean> {
    const executionId = randomUUID();
    const startedAt = Date.now();
    let ownsRun = false;
    let syncSummary: FeedSyncSummary | undefined;
    try {
      const intervalValue = Number(
        this.configService.get<string>('FEED_SYNC_INTERVAL_MINUTES'),
      );
      const intervalMinutes = Number.isFinite(intervalValue) && intervalValue > 0
        ? intervalValue
        : DEFAULT_INTERVAL_MINUTES;
      const now = Date.now();

      if (this.isRunning) {
        return false;
      }
      if (this.lastRunAt !== null && now - this.lastRunAt < intervalMinutes * 60_000) {
        const elapsedMs = now - this.lastRunAt;
        this.logSafely(
          'log',
          `SKIP reason=INTERVAL_NOT_REACHED elapsedMs=${elapsedMs}`,
        );
        await this.appendRunLog({
          schedulerName: FeedSyncScheduler.name,
          startedAt: new Date(startedAt).toISOString(),
          completedAt: new Date(now).toISOString(),
          status: 'skipped',
          durationMs: now - startedAt,
          skipReason: 'INTERVAL_NOT_REACHED',
          elapsedMs,
        });
        return false;
      }

      this.lastRunAt = now;
      this.isRunning = true;
      ownsRun = true;
      this.logSafely('log', `START executionId=${executionId}`);

      syncSummary = await this.feedSyncService.syncSubscribedFeeds();
      for (const failure of syncSummary.feedFailures) {
        this.logSafely(
          'warn',
          `FEED_FAILED executionId=${executionId} feedId=${failure.feedId} ` +
            `errorType=${failure.errorType} durationMs=${failure.durationMs}`,
        );
      }
      for (const recoveredFeed of syncSummary.recoveredFeeds) {
        this.logSafely(
          'log',
          `FEED_RECOVERED executionId=${executionId} feedId=${recoveredFeed.feedId} ` +
            `durationMs=${recoveredFeed.durationMs}`,
        );
      }

      const notificationSummary = await this.notificationService.enqueuePendingNotifications();
      const durationMs = Date.now() - startedAt;
      const completedAt = Date.now();
      this.logSafely(
        'log',
        `SUCCESS executionId=${executionId} durationMs=${durationMs} ` +
          `feeds=${syncSummary.feeds} succeeded=${syncSummary.succeeded} ` +
          `failed=${syncSummary.failed} newArticles=${syncSummary.newArticles} ` +
          `notificationsCreated=${notificationSummary.created}`,
      );
      await this.appendRunLog({
        schedulerName: FeedSyncScheduler.name,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date(completedAt).toISOString(),
        status: 'success',
        durationMs,
        feedSync: {
          feeds: syncSummary.feeds,
          succeeded: syncSummary.succeeded,
          failed: syncSummary.failed,
          newArticles: syncSummary.newArticles,
          notificationsCreated: notificationSummary.created,
          feedFailures: syncSummary.feedFailures,
          recoveredFeeds: syncSummary.recoveredFeeds,
        },
      });
      return true;
    } catch (error) {
      const completedAt = Date.now();
      this.logSafely(
        'error',
        `FAILED executionId=${executionId} durationMs=${completedAt - startedAt} ` +
          `errorType=${classifyError(error)}`,
      );
      const details = error instanceof Error
        ? { message: error.message, stack: error.stack ?? error.message }
        : { message: String(error), stack: String(error) };
      await this.appendRunLog({
        schedulerName: FeedSyncScheduler.name,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date(completedAt).toISOString(),
        status: 'failure',
        durationMs: completedAt - startedAt,
        ...(syncSummary ? {
          feedSync: {
            feeds: syncSummary.feeds,
            succeeded: syncSummary.succeeded,
            failed: syncSummary.failed,
            newArticles: syncSummary.newArticles,
            feedFailures: syncSummary.feedFailures,
            recoveredFeeds: syncSummary.recoveredFeeds,
          },
        } : {}),
        error: details,
      });
      throw error;
    } finally {
      if (ownsRun) {
        this.isRunning = false;
      }
    }
  }

  private async appendRunLog(entry: SchedulerRunLog): Promise<void> {
    try {
      await this.schedulerLogger.append(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logSafely('error', `無法寫入 Scheduler log：${message}`);
    }
  }

  private logSafely(level: 'log' | 'warn' | 'error', message: string): void {
    try {
      if (level === 'log') {
        this.logger.log(message);
      } else if (level === 'warn') {
        this.logger.warn(message);
      } else {
        this.logger.error(message);
      }
    } catch {
      // Logging must not replace the original scheduler outcome.
    }
  }
}