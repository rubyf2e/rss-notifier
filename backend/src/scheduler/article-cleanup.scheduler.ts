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

        for (const feed of feeds) {
          try {
            const articleCount = await this.prisma.article.count({
              where: { feedId: feed.id },
            });
            let articlesToScan = articleCount - retentionLimit;
            if (articlesToScan <= 0) {
              continue;
            }

            const subscriptions = await this.prisma.subscription.findMany({
              where: { feedId: feed.id, status: 'ACTIVE' },
              select: {
                createdAt: true,
                statusHistory: {
                  where: { status: 'ACTIVE' },
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  select: { createdAt: true },
                },
              },
            });
            const activeSinceDates = subscriptions.map(
              (subscription) => subscription.statusHistory[0]?.createdAt ?? subscription.createdAt,
            );
            let scannedSurvivors = 0;

            while (articlesToScan > 0) {
              const articles = await this.prisma.article.findMany({
                where: { feedId: feed.id },
                orderBy: [
                  { publishedAt: { sort: 'desc', nulls: 'last' } },
                  { firstSeenAt: 'desc' },
                  { id: 'desc' },
                ],
                skip: retentionLimit + scannedSurvivors,
                take: Math.min(BATCH_SIZE, articlesToScan),
                select: {
                  id: true,
                  firstSeenAt: true,
                  notifications: { take: 1, select: { id: true } },
                },
              });
              if (articles.length === 0) {
                break;
              }

              const deletableIds = articles
                .filter((article) =>
                  article.notifications.length === 0 &&
                  !activeSinceDates.some((activeSince) => article.firstSeenAt > activeSince),
                )
                .map((article) => article.id);
              const result = deletableIds.length === 0
                ? { count: 0 }
                : await this.prisma.article.deleteMany({
                  where: {
                    id: { in: deletableIds },
                    notifications: { none: {} },
                  },
                });

              deletedCount += result.count;
              scannedSurvivors += articles.length - result.count;
              articlesToScan -= articles.length;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Feed ${feed.id} Article 清理失敗：${message}`);
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

  private async appendRunLog(entry: SchedulerRunLog): Promise<void> {
    try {
      await this.schedulerLogger.append(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`無法寫入 Scheduler log：${message}`);
    }
  }
}