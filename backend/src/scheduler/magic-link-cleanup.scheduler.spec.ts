import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { PersistentSchedulerLogger } from './persistent-scheduler-logger.service';
import { MagicLinkCleanupScheduler } from './magic-link-cleanup.scheduler';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

type MagicLinkFixture = {
  expiresAt: Date;
  usedAt: Date | null;
};

type DeleteManyArgs = {
  where: {
    usedAt: null;
    expiresAt: { lt: Date };
  };
};

describe('MagicLink 清理排程', () => {
  let scheduler: MagicLinkCleanupScheduler;
  let prisma: { magicLink: { deleteMany: jest.Mock } };
  let schedulerLogger: { append: jest.Mock };

  beforeEach(async () => {
    prisma = { magicLink: { deleteMany: jest.fn() } };
    schedulerLogger = { append: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MagicLinkCleanupScheduler,
        { provide: PrismaService, useValue: prisma },
        { provide: PersistentSchedulerLogger, useValue: schedulerLogger },
      ],
    }).compile();

    scheduler = module.get(MagicLinkCleanupScheduler);
  });

  function mockDeleteManyFor(links: MagicLinkFixture[]) {
    prisma.magicLink.deleteMany.mockImplementation(async (args: DeleteManyArgs) => ({
      count: links.filter(
        (link) => link.usedAt === args.where.usedAt && link.expiresAt < args.where.expiresAt.lt,
      ).length,
    }));
  }

  it('刪除已過期且未使用的 MagicLink', async () => {
    mockDeleteManyFor([{ expiresAt: new Date(Date.now() - 60_000), usedAt: null }]);

    await expect(scheduler.cleanupExpiredMagicLinks()).resolves.toBe(1);
  });

  it('不刪除尚未過期且未使用的 MagicLink', async () => {
    mockDeleteManyFor([{ expiresAt: new Date(Date.now() + 60_000), usedAt: null }]);

    await expect(scheduler.cleanupExpiredMagicLinks()).resolves.toBe(0);
  });

  it('不處理已使用但已過期的 MagicLink', async () => {
    mockDeleteManyFor([{ expiresAt: new Date(Date.now() - 60_000), usedAt: new Date() }]);

    await expect(scheduler.cleanupExpiredMagicLinks()).resolves.toBe(0);
  });

  it('以單次 deleteMany 使用指定的 where 條件並回傳刪除筆數', async () => {
    prisma.magicLink.deleteMany.mockResolvedValue({ count: 4 });

    await expect(scheduler.cleanupExpiredMagicLinks()).resolves.toBe(4);

    expect(prisma.magicLink.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.magicLink.deleteMany).toHaveBeenCalledWith({
      where: {
        usedAt: null,
        expiresAt: { lt: expect.any(Date) },
      },
    });
  });

  it('成功時記錄排程名稱、時間、狀態、耗時與刪除筆數', async () => {
    prisma.magicLink.deleteMany.mockResolvedValue({ count: 2 });

    await scheduler.cleanupExpiredMagicLinks();

    expect(schedulerLogger.append).toHaveBeenCalledWith(expect.objectContaining({
      schedulerName: 'MagicLinkCleanupScheduler',
      startedAt: expect.any(String),
      completedAt: expect.any(String),
      status: 'success',
      durationMs: expect.any(Number),
      deletedCount: 2,
    }));
  });

  it('失敗時記錄錯誤訊息與 stack，並保留原有失敗行為', async () => {
    const failure = new Error('database unavailable');
    prisma.magicLink.deleteMany.mockRejectedValue(failure);

    await expect(scheduler.cleanupExpiredMagicLinks()).rejects.toBe(failure);

    expect(schedulerLogger.append).toHaveBeenCalledWith(expect.objectContaining({
      schedulerName: 'MagicLinkCleanupScheduler',
      status: 'failure',
      error: {
        message: failure.message,
        stack: failure.stack,
      },
    }));
  });

  it('持久化 log 寫入失敗時仍回傳 cleanup 結果', async () => {
    prisma.magicLink.deleteMany.mockResolvedValue({ count: 3 });
    schedulerLogger.append.mockRejectedValue(new Error('disk unavailable'));

    await expect(scheduler.cleanupExpiredMagicLinks()).resolves.toBe(3);
  });
});