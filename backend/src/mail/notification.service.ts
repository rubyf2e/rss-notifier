import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAIL_QUEUE,
  MAX_NOTIFICATION_ATTEMPTS,
  MailJobData,
  SEND_ARTICLE_NOTIFICATION_EMAIL_JOB,
} from './mail.constants';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue<MailJobData>,
  ) {}

  async enqueuePendingNotifications(): Promise<{ created: number; queued: number }> {
    const now = new Date();
    await this.prisma.notificationLog.updateMany({
      where: {
        status: 'PROCESSING',
        updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) },
      },
      data: { status: 'PENDING' },
    });

    const subscriptions = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE' },
      include: { statusHistory: { orderBy: { createdAt: 'desc' } } },
    });
    const activeSubscriptions = subscriptions.map((subscription) => ({
      subscription,
      activeSince: subscription.statusHistory.find((entry) => entry.status === 'ACTIVE')
        ?.createdAt ?? subscription.createdAt,
    }));
    const articles = activeSubscriptions.length === 0
      ? []
      : await this.prisma.article.findMany({
        where: {
          OR: activeSubscriptions.map(({ subscription, activeSince }) => ({
            feedId: subscription.feedId,
            firstSeenAt: { gt: activeSince },
          })),
        },
        select: { id: true, feedId: true, firstSeenAt: true },
      });
    const notificationsToCreate = activeSubscriptions.flatMap(({ subscription, activeSince }) =>
      articles
        .filter((article) =>
          article.feedId === subscription.feedId && article.firstSeenAt > activeSince,
        )
        .map((article) => ({
          subscriptionId: subscription.id,
          articleId: article.id,
          status: 'PENDING',
        })),
    );
    const creationResult = notificationsToCreate.length === 0
      ? { count: 0 }
      : await this.prisma.notificationLog.createMany({
        data: notificationsToCreate,
        skipDuplicates: true,
      });
    const created = creationResult.count;

    const pendingLogs = await this.prisma.notificationLog.findMany({
      where: {
        status: 'PENDING',
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      },
      include: {
        subscription: {
          include: { statusHistory: { orderBy: { createdAt: 'desc' } } },
        },
        article: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const skippedLogIds: bigint[] = [];
    const logsToQueue = [];

    for (const log of pendingLogs) {
      const activeSince = log.subscription.statusHistory.find(
        (entry) => entry.status === 'ACTIVE',
      )?.createdAt ?? log.subscription.createdAt;
      if (
        log.subscription.status !== 'ACTIVE' ||
        log.article.firstSeenAt <= activeSince
      ) {
        skippedLogIds.push(log.id);
        continue;
      }

      logsToQueue.push(log);
    }

    if (skippedLogIds.length > 0) {
      await this.prisma.notificationLog.updateMany({
        where: { id: { in: skippedLogIds }, status: 'PENDING' },
        data: { status: 'SKIPPED', nextRetryAt: null },
      });
    }

    let queued = 0;
    for (const log of logsToQueue) {

      try {
        await this.mailQueue.add(
          SEND_ARTICLE_NOTIFICATION_EMAIL_JOB,
          { notificationLogId: log.id.toString() },
          {
            jobId: `notification-${log.id}`,
            attempts: MAX_NOTIFICATION_ATTEMPTS,
            backoff: { type: 'exponential', delay: 1_000 },
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
        queued += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`無法排入 NotificationLog ${log.id}：${message}`);
      }
    }

    return { created, queued };
  }
}