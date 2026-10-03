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

  beforeEach(() => {
    configService = { get: jest.fn().mockReturnValue('1') };
    feedSyncService = { syncSubscribedFeeds: jest.fn().mockResolvedValue(undefined) };
    notificationService = {
      enqueuePendingNotifications: jest.fn().mockResolvedValue(undefined),
    };
    notificationService = {
      enqueuePendingNotifications: jest.fn().mockResolvedValue(undefined),
    };
    scheduler = new FeedSyncScheduler(
      configService as unknown as ConfigService,
      feedSyncService as unknown as FeedSyncService,
      notificationService as unknown as NotificationService,
    );
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  it('依設定的一分鐘間隔執行並略過未到期的分鐘', async () => {
    await expect(scheduler.syncIfDue()).resolves.toBe(true);
    dateNowSpy.mockReturnValue(59_999);
    await expect(scheduler.syncIfDue()).resolves.toBe(false);
    dateNowSpy.mockReturnValue(60_000);
    await expect(scheduler.syncIfDue()).resolves.toBe(true);

    expect(feedSyncService.syncSubscribedFeeds).toHaveBeenCalledTimes(2);
    expect(notificationService.enqueuePendingNotifications).toHaveBeenCalledTimes(2);
  });

  it('未設定或無效間隔時預設 15 分鐘', async () => {
    configService.get.mockReturnValue('0');
    await scheduler.syncIfDue();
    dateNowSpy.mockReturnValue(14 * 60_000);
    await expect(scheduler.syncIfDue()).resolves.toBe(false);
    dateNowSpy.mockReturnValue(15 * 60_000);
    await expect(scheduler.syncIfDue()).resolves.toBe(true);
  });

  it('排程錯誤不向外拋出，也能在下個週期繼續', async () => {
    feedSyncService.syncSubscribedFeeds.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(scheduler.syncIfDue()).resolves.toBe(true);
    dateNowSpy.mockReturnValue(60_000);
    await expect(scheduler.syncIfDue()).resolves.toBe(true);
    expect(feedSyncService.syncSubscribedFeeds).toHaveBeenCalledTimes(2);
  });
});