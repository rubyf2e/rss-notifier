import { INestApplicationContext, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppModule } from '../app.module';
import { ArticleCleanupScheduler } from './article-cleanup.scheduler';
import { FeedSyncScheduler } from './feed-sync.scheduler';
import { MagicLinkCleanupScheduler } from './magic-link-cleanup.scheduler';
import { runSchedulerCommand } from './scheduler-command';

jest.mock('../app.module', () => ({ AppModule: class AppModule {} }));
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('Scheduler command', () => {
  let context: {
    get: jest.Mock;
    close: jest.Mock;
  };
  let stopCron: jest.Mock;
  let createApplicationContextSpy: jest.SpyInstance;
  let createHttpApplicationSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    stopCron = jest.fn();
    context = {
      get: jest.fn((token: unknown) => {
        if (token === SchedulerRegistry) {
          return { getCronJobs: () => new Map([['scheduled-job', { stop: stopCron }]]) };
        }
        if (token === FeedSyncScheduler) {
          return { syncIfDue: jest.fn().mockResolvedValue(true) };
        }
        if (token === ArticleCleanupScheduler) {
          return { cleanupOldArticles: jest.fn().mockResolvedValue(0) };
        }
        if (token === MagicLinkCleanupScheduler) {
          return { cleanupExpiredMagicLinks: jest.fn().mockResolvedValue(0) };
        }
        throw new Error('Unexpected provider');
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    createApplicationContextSpy = jest
      .spyOn(NestFactory, 'createApplicationContext')
      .mockResolvedValue(context as unknown as INestApplicationContext);
    createHttpApplicationSpy = jest.spyOn(NestFactory, 'create');
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['feed-sync', FeedSyncScheduler, 'syncIfDue'],
    ['article-cleanup', ArticleCleanupScheduler, 'cleanupOldArticles'],
    ['magic-link-cleanup', MagicLinkCleanupScheduler, 'cleanupExpiredMagicLinks'],
  ])('command %s 呼叫對應 scheduler 並正常關閉 context', async (command, provider, method) => {
    await expect(runSchedulerCommand(command)).resolves.toBe(0);

    expect(createApplicationContextSpy).toHaveBeenCalledWith(AppModule);
    expect(context.get).toHaveBeenCalledWith(provider, { strict: false });
    const scheduler = context.get.mock.results.find((result) =>
      result.value && method in result.value,
    )?.value;
    expect(scheduler[method]).toHaveBeenCalledTimes(1);
    expect(stopCron).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(createHttpApplicationSpy).not.toHaveBeenCalled();
  });

  it('scheduler 發生錯誤時回傳非 0 並關閉 context', async () => {
    const failure = new Error('sync failed');
    context.get.mockImplementation((token: unknown) => {
      if (token === SchedulerRegistry) {
        return { getCronJobs: () => new Map() };
      }
      if (token === FeedSyncScheduler) {
        return { syncIfDue: jest.fn().mockRejectedValue(failure) };
      }
      throw new Error('Unexpected provider');
    });

    await expect(runSchedulerCommand('feed-sync')).resolves.toBe(1);

    expect(context.close).toHaveBeenCalledTimes(1);
    expect(createHttpApplicationSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      'Scheduler command failed: feed-sync errorType=Error',
    );
  });

  it('未知 command 不啟動 application context', async () => {
    await expect(runSchedulerCommand('missing')).resolves.toBe(1);

    expect(createApplicationContextSpy).not.toHaveBeenCalled();
  });
});