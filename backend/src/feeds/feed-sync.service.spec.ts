import { PrismaService } from '../prisma/prisma.service';
import { FeedFetcherService } from './feed-fetcher.service';
import { FeedSyncService } from './feed-sync.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('FeedSyncService', () => {
  let service: FeedSyncService;
  let prisma: {
    feed: { findMany: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let transaction: {
    article: { createMany: jest.Mock };
    feed: { update: jest.Mock };
  };
  let feedFetcher: { fetchAndParse: jest.Mock };

  const subscribedFeeds = [
    {
      id: 1n,
      url: 'https://broken.example/feed.xml',
      initialSyncCompleted: true,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    },
    {
      id: 2n,
      url: 'https://healthy.example/feed.xml',
      initialSyncCompleted: false,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    },
  ];

  beforeEach(() => {
    transaction = {
      article: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      feed: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      feed: {
        findMany: jest.fn().mockResolvedValue(subscribedFeeds),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    feedFetcher = {
      fetchAndParse: jest.fn()
        .mockRejectedValueOnce(new Error('network unavailable'))
        .mockResolvedValueOnce({
          url: subscribedFeeds[1].url,
          title: 'Healthy Feed',
          description: null,
          siteUrl: null,
          items: [{
            guid: 'article-1',
            title: 'Article 1',
            link: 'https://healthy.example/1',
            description: null,
            publishedAt: null,
          }],
        }),
    };
    service = new FeedSyncService(
      prisma as unknown as PrismaService,
      feedFetcher as unknown as FeedFetcherService,
    );
  });

  it('逐一同步 Feed；單一錯誤留下狀態但不阻止其他 Feed，初次同步只建立基準', async () => {
    await expect(service.syncSubscribedFeeds()).resolves.toEqual({ succeeded: 1, failed: 1 });

    expect(prisma.feed.findMany).toHaveBeenCalledWith({
      where: { subscriptions: { some: {} } },
      select: {
        id: true,
        url: true,
        initialSyncCompleted: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
    });
    expect(prisma.feed.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: {
        status: 'ERROR',
        lastError: 'network unavailable',
        lastErrorAt: expect.any(Date),
      },
    });
    expect(transaction.article.createMany).toHaveBeenCalledWith({
      data: [{
        feedId: 2n,
        guid: 'article-1',
        title: 'Article 1',
        link: 'https://healthy.example/1',
        description: null,
        publishedAt: null,
        firstSeenAt: subscribedFeeds[1].createdAt,
      }],
      skipDuplicates: true,
    });
    expect(transaction.feed.update).toHaveBeenCalledWith({
      where: { id: 2n },
      data: expect.objectContaining({
        initialSyncCompleted: true,
        status: 'HEALTHY',
        lastError: null,
        lastErrorAt: null,
        lastSyncedAt: expect.any(Date),
      }),
    });
  });

  it('每次同步使用 skipDuplicates，避免重複建立同一篇文章', async () => {
    await service.syncSubscribedFeeds();

    expect(transaction.article.createMany).toHaveBeenCalledTimes(1);
    expect(transaction.article.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });
});