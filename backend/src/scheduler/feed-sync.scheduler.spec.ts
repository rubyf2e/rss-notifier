import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../mail/notification.service';
import { FeedSyncService } from '../feeds/feed-sync.service';
import { FeedSyncScheduler } from './feed-sync.scheduler';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('FeedSyncScheduler', () => {
  let scheduler: FeedSyncScheduler;
  let configService: { get: jest.Mock };
  let feedSyncService: { syncSubscribedFeeds: jest.Mock };
  let notificationService: { enqueuePendingNotifications: jest.Mock };
  let dateNowSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    configService = { get: jest.fn().mockReturnValue('1') };
    feedSyncService = {
      syncSubscribedFeeds: jest.fn().mockResolvedValue({
        feeds: 1,
        succeeded: 1,
        failed: 0,
        newArticles: 2,
        feedFailures: [],
        recoveredFeeds: [],
      }),
    };
    notificationService = {
      enqueuePendingNotifications: jest.fn().mockResolvedValue({ created: 1, queued: 1 }),
    };
    scheduler = new FeedSyncScheduler(
      configService as unknown as ConfigService,
      feedSyncService as unknown as FeedSyncService,
      notificationService as unknown as NotificationService,
    );
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('依設定的一分鐘間隔執行並略過未到期的分鐘', async () => {
    await expect(scheduler.syncIfDue()).resolves.toBe(true);
    dateNowSpy.mockReturnValue(59_999);
    await expect(scheduler.syncIfDue()).resolves.toBe(false);
    dateNowSpy.mockReturnValue(60_000);
    await expect(scheduler.syncIfDue()).resolves.toBe(true);

    expect(feedSyncService.syncSubscribedFeeds).toHaveBeenCalledTimes(2);
    expect(notificationService.enqueuePendingNotifications).toHaveBeenCalledTimes(2);
    expect(logSpy.mock.calls.filter(([message]) => String(message).startsWith('START ')))
      .toHaveLength(2);
    expect(logSpy.mock.calls.some(([message]) =>
      String(message).includes('SKIP reason=INTERVAL_NOT_REACHED elapsedMs=59999')),
    ).toBe(true);
  });

  it('未設定或無效間隔時預設 15 分鐘', async () => {
    configService.get.mockReturnValue('0');
    await scheduler.syncIfDue();
    dateNowSpy.mockReturnValue(14 * 60_000);
    await expect(scheduler.syncIfDue()).resolves.toBe(false);
    dateNowSpy.mockReturnValue(15 * 60_000);
    await expect(scheduler.syncIfDue()).resolves.toBe(true);
  });

  it('同步完成時輸出 aggregate SUCCESS summary', async () => {
    await expect(scheduler.syncIfDue()).resolves.toBe(true);

    expect(logSpy.mock.calls.some(([message]) =>
      String(message).match(
        /^SUCCESS executionId=.* durationMs=\d+ feeds=1 succeeded=1 failed=0 newArticles=2 notificationsCreated=1$/,
      ),
    )).toBe(true);
  });

  it('單一 Feed 失敗時記錄安全警告並繼續排入通知', async () => {
    feedSyncService.syncSubscribedFeeds.mockResolvedValueOnce({
      feeds: 2,
      succeeded: 1,
      failed: 1,
      newArticles: 1,
      feedFailures: [{ feedId: '9', errorType: 'BadRequestException', durationMs: 12 }],
      recoveredFeeds: [],
    });

    await expect(scheduler.syncIfDue()).resolves.toBe(true);

    expect(warnSpy.mock.calls.some(([message]) =>
      String(message).match(
        /^FEED_FAILED executionId=.* feedId=9 errorType=BadRequestException durationMs=12$/,
      ),
    )).toBe(true);
    expect(notificationService.enqueuePendingNotifications).toHaveBeenCalledTimes(1);
  });

  it('未預期錯誤記錄 FAILED 後原樣拋出，且不記錄敏感錯誤訊息', async () => {
    const originalError = new Error(
      'DATABASE_URL=postgres://user:password@host/db Bearer secret https://private.example/feed',
    );
    feedSyncService.syncSubscribedFeeds.mockRejectedValueOnce(originalError);

    await expect(scheduler.syncIfDue()).rejects.toBe(originalError);
    expect(errorSpy.mock.calls.some(([message]) =>
      String(message).match(/^FAILED executionId=.* durationMs=\d+ errorType=Error$/),
    )).toBe(true);
    const allLoggedText = [logSpy, warnSpy, errorSpy]
      .flatMap((spy) => spy.mock.calls.map(([message]) => String(message)))
      .join('\n');
    expect(allLoggedText).not.toContain('postgres://');
    expect(allLoggedText).not.toContain('Bearer secret');
    expect(allLoggedText).not.toContain('private.example');

    dateNowSpy.mockReturnValue(60_000);
    await expect(scheduler.syncIfDue()).resolves.toBe(true);
    expect(feedSyncService.syncSubscribedFeeds).toHaveBeenCalledTimes(2);
  });

  it('logger 發生錯誤時不覆蓋原始排程例外', async () => {
    const originalError = new Error('sync failed');
    feedSyncService.syncSubscribedFeeds.mockRejectedValueOnce(originalError);
    errorSpy.mockImplementation(() => {
      throw new Error('logger failed');
    });

    await expect(scheduler.syncIfDue()).rejects.toBe(originalError);
  });
});