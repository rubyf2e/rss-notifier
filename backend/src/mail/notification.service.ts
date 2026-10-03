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
    let created = 0;

    for (const subscription of subscriptions) {
      const activeSince = subscription.statusHistory.find((entry) => entry.status === 'ACTIVE')
        ?.createdAt ?? subscription.createdAt;
      const articles = await this.prisma.article.findMany({
        where: {
          feedId: subscription.feedId,
          firstSeenAt: { gt: activeSince },
        },
        select: { id: true },
      });

      if (articles.length === 0) {
        continue;
      }

      const result = await this.prisma.notificationLog.createMany({
        data: articles.map((article) => ({
          subscriptionId: subscription.id,
          articleId: article.id,
          status: 'PENDING',
        })),
        skipDuplicates: true,
      });
      created += result.count;
    }

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
    let queued = 0;

    for (const log of pendingLogs) {
      const activeSince = log.subscription.statusHistory.find(
        (entry) => entry.status === 'ACTIVE',
      )?.createdAt ?? log.subscription.createdAt;
      if (
        log.subscription.status !== 'ACTIVE' ||
        log.article.firstSeenAt <= activeSince
      ) {
        await this.prisma.notificationLog.updateMany({
          where: { id: log.id, status: 'PENDING' },
          data: { status: 'SKIPPED', nextRetryAt: null },
        });
        continue;
      }

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