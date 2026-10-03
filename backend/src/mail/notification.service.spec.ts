import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAIL_QUEUE,
  MAX_NOTIFICATION_ATTEMPTS,
  SEND_ARTICLE_NOTIFICATION_EMAIL_JOB,
} from './mail.constants';
import { NotificationService } from './notification.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('NotificationService', () => {
  let service: NotificationService;
  let prisma: {
    subscription: { findMany: jest.Mock };
    article: { findMany: jest.Mock };
    notificationLog: { createMany: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };
  };
  let mailQueue: { add: jest.Mock };

  const activeSince = new Date('2026-10-02T00:00:00.000Z');
  const subscription = {
    id: 7n,
    publicId: 'subscription-7',
    feedId: 9n,
    status: 'ACTIVE',
    createdAt: activeSince,
    statusHistory: [{ status: 'ACTIVE', createdAt: activeSince }],
  };
  const pendingLog = {
    id: 44n,
    subscription,
    article: { id: 12n, firstSeenAt: new Date('2026-10-03T00:00:00.000Z') },
  };

  beforeEach(async () => {
    prisma = {
      subscription: { findMany: jest.fn().mockResolvedValue([subscription]) },
      article: { findMany: jest.fn().mockResolvedValue([{ id: 12n }]) },
      notificationLog: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([pendingLog]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    mailQueue = { add: jest.fn().mockResolvedValue({ id: 'notification-44' }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken(MAIL_QUEUE), useValue: mailQueue },
      ],
    }).compile();
    service = module.get(NotificationService);
  });

  it('為新文章建立持久通知紀錄並排入具退避與上限的 mail job', async () => {
    await expect(service.enqueuePendingNotifications()).resolves.toEqual({
      created: 1,
      queued: 1,
    });

    expect(prisma.subscription.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
      include: { statusHistory: { orderBy: { createdAt: 'desc' } } },
    });
    expect(prisma.article.findMany).toHaveBeenCalledWith({
      where: { feedId: 9n, firstSeenAt: { gt: activeSince } },
      select: { id: true },
    });
    expect(prisma.notificationLog.createMany).toHaveBeenCalledWith({
      data: [{ subscriptionId: 7n, articleId: 12n, status: 'PENDING' }],
      skipDuplicates: true,
    });
    expect(mailQueue.add).toHaveBeenCalledWith(
      SEND_ARTICLE_NOTIFICATION_EMAIL_JOB,
      { notificationLogId: '44' },
      {
        jobId: 'notification-44',
        attempts: MAX_NOTIFICATION_ATTEMPTS,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  });

  it('恢復訂閱後略過暫停期間建立的 pending log', async () => {
    const resumedAt = new Date('2026-10-03T12:00:00.000Z');
    const resumedSubscription = {
      ...subscription,
      statusHistory: [
        { status: 'ACTIVE', createdAt: resumedAt },
        { status: 'PAUSED', createdAt: new Date('2026-10-03T06:00:00.000Z') },
        { status: 'ACTIVE', createdAt: activeSince },
      ],
    };
    prisma.subscription.findMany.mockResolvedValue([resumedSubscription]);
    prisma.article.findMany.mockResolvedValue([]);
    prisma.notificationLog.findMany.mockResolvedValue([{
      ...pendingLog,
      subscription: resumedSubscription,
      article: { id: 12n, firstSeenAt: new Date('2026-10-03T08:00:00.000Z') },
    }]);

    await service.enqueuePendingNotifications();

    expect(prisma.article.findMany).toHaveBeenCalledWith({
      where: { feedId: 9n, firstSeenAt: { gt: resumedAt } },
      select: { id: true },
    });
    expect(prisma.notificationLog.updateMany).toHaveBeenCalledWith({
      where: { id: 44n, status: 'PENDING' },
      data: { status: 'SKIPPED', nextRetryAt: null },
    });
    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('Queue 暫時不可用時保留資料庫 pending log 供下次排程重試 enqueue', async () => {
    mailQueue.add.mockRejectedValue(new Error('Redis unavailable'));

    await expect(service.enqueuePendingNotifications()).resolves.toEqual({
      created: 1,
      queued: 0,
    });
    expect(prisma.notificationLog.createMany).toHaveBeenCalled();
  });
});