import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PersistentSchedulerLogger } from './persistent-scheduler-logger.service';
import { ArticleCleanupScheduler } from './article-cleanup.scheduler';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('Article 清理排程', () => {
  let scheduler: ArticleCleanupScheduler;
  let configService: { get: jest.Mock };
  let prisma: {
    feed: { findMany: jest.Mock };
    $executeRaw: jest.Mock;
  };
  let schedulerLogger: { append: jest.Mock };

  beforeEach(async () => {
    configService = { get: jest.fn().mockReturnValue('2') };
    prisma = {
      feed: { findMany: jest.fn().mockResolvedValue([]) },
      $executeRaw: jest.fn().mockResolvedValue(0),
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

  it('以單次資料庫批次操作依 Feed 排名清理超額文章', async () => {
    prisma.feed.findMany
      .mockResolvedValueOnce([{ id: 7n }])
      .mockResolvedValueOnce([]);
    prisma.$executeRaw.mockResolvedValueOnce(504);

    await expect(scheduler.cleanupOldArticles()).resolves.toBe(504);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const [query, ...values] = prisma.$executeRaw.mock.calls[0];
    expect(query.join('')).toContain('ROW_NUMBER() OVER');
    expect(query.join('')).toContain('PARTITION BY article.feed_id');
    expect(query.join('')).toContain('article_rank >');
    expect(values).toEqual([0n, 7n, 2]);
  });

  it('未超過保留數量時不刪除文章', async () => {
    await expect(scheduler.cleanupOldArticles()).resolves.toBe(0);

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('未設定保留數量時預設每個 Feed 保留五篇', async () => {
    configService.get.mockReturnValue(undefined);
    prisma.feed.findMany
      .mockResolvedValueOnce([{ id: 7n }])
      .mockResolvedValueOnce([]);
    prisma.$executeRaw.mockResolvedValueOnce(1);

    await expect(scheduler.cleanupOldArticles()).resolves.toBe(1);

    expect(prisma.$executeRaw.mock.calls[0]).toContain(5);
  });

  it('SQL 排除仍被通知引用或 active subscription 需要的文章', async () => {
    prisma.feed.findMany
      .mockResolvedValueOnce([{ id: 7n }])
      .mockResolvedValueOnce([]);
    prisma.$executeRaw.mockResolvedValueOnce(0);

    await expect(scheduler.cleanupOldArticles()).resolves.toBe(0);

    const query = prisma.$executeRaw.mock.calls[0][0].join('');
    expect(query).toContain('notification_logs');
    expect(query).toContain('subscription_status_history');
    expect(query).toContain("subscription.status = 'ACTIVE'");
  });

  it('Feed 以有限批次載入並共用一次清理查詢', async () => {
    prisma.feed.findMany
      .mockResolvedValueOnce([{ id: 7n }, { id: 8n }])
      .mockResolvedValueOnce([]);
    prisma.$executeRaw.mockResolvedValueOnce(4);

    await expect(scheduler.cleanupOldArticles()).resolves.toBe(4);

    expect(prisma.feed.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw.mock.calls[0]).toEqual([
      expect.any(Array), 0n, 8n, 2,
    ]);
    expect(schedulerLogger.append).toHaveBeenCalledWith(expect.objectContaining({
      schedulerName: 'ArticleCleanupScheduler',
      status: 'success',
      deletedCount: 4,
    }));
  });

  it('批次清理失敗時逐 Feed fallback，單一失敗不阻止其他 Feed', async () => {
    prisma.feed.findMany
      .mockResolvedValueOnce([{ id: 7n }, { id: 8n }])
      .mockResolvedValueOnce([]);
    prisma.$executeRaw
      .mockRejectedValueOnce(new Error('batch unavailable'))
      .mockResolvedValueOnce(4)
      .mockRejectedValueOnce(new Error('feed unavailable'));

    await expect(scheduler.cleanupOldArticles()).resolves.toBe(4);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
    expect(prisma.$executeRaw.mock.calls.map((call) => call.slice(1))).toEqual([
      [0n, 8n, 2],
      [0n, 7n, 2],
      [7n, 8n, 2],
    ]);
    expect(schedulerLogger.append).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success',
      deletedCount: 4,
    }));
  });
});