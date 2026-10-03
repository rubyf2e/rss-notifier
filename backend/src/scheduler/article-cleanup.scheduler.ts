import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  PersistentSchedulerLogger,
  SchedulerRunLog,
} from './persistent-scheduler-logger.service';

const DEFAULT_ARTICLE_RETENTION_PER_FEED = 5;
const BATCH_SIZE = 500;

@Injectable()
export class ArticleCleanupScheduler {
  private readonly logger = new Logger(ArticleCleanupScheduler.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly schedulerLogger: PersistentSchedulerLogger,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupOldArticles(): Promise<number> {
    const startedAt = new Date();

    try {
      const configuredLimit = Number(
        this.configService.get<string>('ARTICLE_RETENTION_PER_FEED'),
      );
      const retentionLimit = Number.isInteger(configuredLimit) && configuredLimit > 0
        ? configuredLimit
        : DEFAULT_ARTICLE_RETENTION_PER_FEED;
      let cursor = 0n;
      let deletedCount = 0;

      while (true) {
        const feeds = await this.prisma.feed.findMany({
          where: { id: { gt: cursor } },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
          select: { id: true },
        });
        if (feeds.length === 0) {
          break;
        }

        try {
          deletedCount += await this.deleteOldArticles(
            cursor,
            feeds[feeds.length - 1].id,
            retentionLimit,
          );
        } catch {
          let feedCursor = cursor;
          for (const feed of feeds) {
            try {
              deletedCount += await this.deleteOldArticles(
                feedCursor,
                feed.id,
                retentionLimit,
              );
            } catch (feedError) {
              const message = feedError instanceof Error
                ? feedError.message
                : String(feedError);
              this.logger.warn(`Feed ${feed.id} Article 清理失敗：${message}`);
            }
            feedCursor = feed.id;
          }
        }

        cursor = feeds[feeds.length - 1].id;
      }

      const completedAt = new Date();
      await this.appendRunLog({
        schedulerName: ArticleCleanupScheduler.name,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        status: 'success',
        durationMs: completedAt.getTime() - startedAt.getTime(),
        deletedCount,
      });
      this.logger.log(`已清理 ${deletedCount} 篇舊 Article`);
      return deletedCount;
    } catch (error) {
      const completedAt = new Date();
      const details = error instanceof Error
        ? { message: error.message, stack: error.stack ?? error.message }
        : { message: String(error), stack: String(error) };

      await this.appendRunLog({
        schedulerName: ArticleCleanupScheduler.name,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        status: 'failure',
        durationMs: completedAt.getTime() - startedAt.getTime(),
        error: details,
      });
      throw error;
    }
  }

  private deleteOldArticles(cursor: bigint, lastFeedId: bigint, retentionLimit: number) {
    return this.prisma.$executeRaw`
      WITH ranked_articles AS (
        SELECT
          article.id,
          article.feed_id,
          article.first_seen_at,
          ROW_NUMBER() OVER (
            PARTITION BY article.feed_id
            ORDER BY article.published_at DESC NULLS LAST,
              article.first_seen_at DESC,
              article.id DESC
          ) AS article_rank
        FROM articles AS article
        WHERE article.feed_id > ${cursor}
          AND article.feed_id <= ${lastFeedId}
      )
      DELETE FROM articles AS article
      USING ranked_articles
      WHERE article.id = ranked_articles.id
        AND ranked_articles.article_rank > ${retentionLimit}
        AND NOT EXISTS (
          SELECT 1 FROM notification_logs AS notification
          WHERE notification.article_id = article.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions AS subscription
          WHERE subscription.feed_id = article.feed_id
            AND subscription.status = 'ACTIVE'
            AND article.first_seen_at > COALESCE(
              (
                SELECT MAX(history.created_at)
                FROM subscription_status_history AS history
                WHERE history.subscription_id = subscription.id
                  AND history.status = 'ACTIVE'
              ),
              subscription.created_at
            )
        )
    `;
  }

  private async appendRunLog(entry: SchedulerRunLog): Promise<void> {
    try {
      await this.schedulerLogger.append(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`無法寫入 Scheduler log：${message}`);
    }
  }
}