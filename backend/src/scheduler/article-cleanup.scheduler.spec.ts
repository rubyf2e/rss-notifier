import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PersistentSchedulerLogger } from './persistent-scheduler-logger.service';
import { ArticleCleanupScheduler } from './article-cleanup.scheduler';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

type ArticleFixture = {
  id: bigint;
  firstSeenAt: Date;
  notifications: Array<{ id: bigint }>;
};

function makeArticles(firstId: bigint, count: number, firstSeenAt = new Date('2026-10-01T00:00:00Z')) {
  return Array.from({ length: count }, (_, index): ArticleFixture => ({
    id: firstId + BigInt(index),
    firstSeenAt,
    notifications: [],
  }));
}

describe('Article 清理排程', () => {
  let scheduler: ArticleCleanupScheduler;
  let configService: { get: jest.Mock };
  let prisma: {
    feed: { findMany: jest.Mock };
    article: { count: jest.Mock; findMany: jest.Mock; deleteMany: jest.Mock };
    subscription: { findMany: jest.Mock };
  };
  let schedulerLogger: { append: jest.Mock };

  beforeEach(async () => {
    configService = { get: jest.fn().mockReturnValue('2') };
    prisma = {
      feed: { findMany: jest.fn().mockResolvedValue([]) },
      article: {
        count: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      subscription: { findMany: jest.fn().mockResolvedValue([]) },
    };
    schedulerLogger = { append: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArticleCleanupScheduler,
        { provide: ConfigService, useValue: configService },
        { provide: PrismaService, useValue: prisma },
        { provide: PersistentSchedulerLogger, useValue: schedulerLogger },
      ],
    }).compile();

    scheduler = module.get(ArticleCleanupScheduler);
  });

  it('超過保留數量時，只刪除排名在保留範圍外的舊文章並分批處理', async () => {
    prisma.feed.findMany
      .mockResolvedValueOnce([{ id: 7n }])
      .mockResolvedValueOnce([]);
    prisma.article.count.mockResolvedValue(504);
    prisma.article.findMany
      .mockResolvedValueOnce(makeArticles(1n, 500))
      .mockResolvedValueOnce(makeArticles(501n, 2));
    prisma.article.deleteMany
      .mockResolvedValueOnce({ count: 500 })
      .mockResolvedValueOnce({ count: 4 });

    await expect(scheduler.cleanupOldArticles()).resolves.toBe(504);

    expect(prisma.article.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { feedId: 7n },
      orderBy: [
        { publishedAt: { sort: 'desc', nulls: 'last' } },
        { firstSeenAt: 'desc' },
        { id: 'desc' },
      ],
      skip: 2,
      take: 500,
    }));
    expect(prisma.article.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      skip: 2,
      take: 2,
    }));
    expect(prisma.article.deleteMany).toHaveBeenCalledTimes(2);
    expect(prisma.article.deleteMany.mock.calls[0][0].where).toEqual({
      id: { in: makeArticles(1n, 500).map((article) => article.id) },
      notifications: { none: {} },
    });
  });

  it('未超過保留數量時不刪除文章', async () => {
    prisma.feed.findMany
      .mockResolvedValueOnce([{ id: 7n }])
      .mockResolvedValueOnce([]);
    prisma.article.count.mockResolvedValue(2);

    await expect(scheduler.cleanupOldArticles()).resolves.toBe(0);

    expect(prisma.article.findMany).not.toHaveBeenCalled();
    expect(prisma.article.deleteMany).not.toHaveBeenCalled();
  });

  it('未設定保留數量時預設每個 Feed 保留五篇', async () => {
    configService.get.mockReturnValue(undefined);
    prisma.feed.findMany
      .mockResolvedValueOnce([{ id: 7n }])
      .mockResolvedValueOnce([]);
    prisma.article.count.mockResolvedValue(6);
    prisma.article.findMany.mockResolvedValue(makeArticles(1n, 1));
    prisma.article.deleteMany.mockResolvedValue({ count: 1 });

    await expect(scheduler.cleanupOldArticles()).resolves.toBe(1);

    expect(prisma.article.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 5,
      take: 1,
    }));
  });

  it('不刪除仍被 NotificationLog 引用的文章', async () => {
    prisma.feed.findMany
      .mockResolvedValueOnce([{ id: 7n }])
      .mockResolvedValueOnce([]);
    prisma.article.count.mockResolvedValue(3);
    prisma.article.findMany.mockResolvedValue([{
      ...makeArticles(3n, 1)[0],
      notifications: [{ id: 9n }],
    }]);

    await expect(scheduler.cleanupOldArticles()).resolves.toBe(0);

    expect(prisma.article.deleteMany).not.toHaveBeenCalled();
  });

  it('不刪除仍被啟用中訂閱通知流程需要的文章', async () => {
    const activeSince = new Date('2026-10-02T00:00:00Z');
    prisma.feed.findMany
      .mockResolvedValueOnce([{ id: 7n }])
      .mockResolvedValueOnce([]);
    prisma.article.count.mockResolvedValue(3);
    prisma.subscription.findMany.mockResolvedValue([{
      createdAt: activeSince,
      statusHistory: [{ createdAt: activeSince }],
    }]);
    prisma.article.findMany.mockResolvedValue([makeArticles(
      3n,
      1,
      new Date('2026-10-03T00:00:00Z'),
    )[0]]);

    await expect(scheduler.cleanupOldArticles()).resolves.toBe(0);

    expect(prisma.article.deleteMany).not.toHaveBeenCalled();
  });

  it('單一 Feed 清理失敗時仍繼續清理其他 Feed', async () => {
    prisma.feed.findMany
      .mockResolvedValueOnce([{ id: 7n }, { id: 8n }])
      .mockResolvedValueOnce([]);
    prisma.article.count.mockImplementation(async ({ where }: { where: { feedId: bigint } }) => {
      const feedId = where.feedId;
      if (feedId === 7n) {
        throw new Error('database unavailable');
      }
      return 6;
    });
    prisma.article.findMany.mockResolvedValue(makeArticles(1n, 4));
    prisma.article.deleteMany.mockResolvedValue({ count: 4 });

    await expect(scheduler.cleanupOldArticles()).resolves.toBe(4);

    expect(prisma.article.count).toHaveBeenCalledTimes(2);
    expect(prisma.article.count.mock.calls[1][0]).toEqual({ where: { feedId: 8n } });
    expect(schedulerLogger.append).toHaveBeenCalledWith(expect.objectContaining({
      schedulerName: 'ArticleCleanupScheduler',
      status: 'success',
      deletedCount: 4,
    }));
  });
});