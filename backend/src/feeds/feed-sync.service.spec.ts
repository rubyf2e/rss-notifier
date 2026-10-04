import { PrismaService } from '../prisma/prisma.service';
import {
  FeedFetcherService,
  FeedResponseTooLargeException,
} from './feed-fetcher.service';
import { FeedSsrfBlockedException } from './feed-url.validator';
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
      status: 'HEALTHY',
    },
    {
      id: 2n,
      url: 'https://healthy.example/feed.xml',
      initialSyncCompleted: false,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      status: 'HEALTHY',
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
    const summary = await service.syncSubscribedFeeds();
    expect(summary).toEqual({
      feeds: 2,
      succeeded: 1,
      failed: 1,
      newArticles: 1,
      feedFailures: [{
        feedId: '1',
        errorType: 'Error',
        durationMs: expect.any(Number),
      }],
      recoveredFeeds: [],
    });

    expect(prisma.feed.findMany).toHaveBeenCalledWith({
      where: { subscriptions: { some: {} } },
      select: {
        id: true,
        url: true,
        initialSyncCompleted: true,
        createdAt: true,
        status: true,
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

  it('依 publishedAt 由新到舊新增文章，無日期文章排在最後', async () => {
    const feed = subscribedFeeds[1];
    prisma.feed.findMany.mockResolvedValue([feed]);
    feedFetcher.fetchAndParse.mockReset().mockResolvedValue({
      url: feed.url,
      title: 'Healthy Feed',
      description: null,
      siteUrl: null,
      items: [
        {
          guid: 'older',
          title: 'Older article',
          link: 'https://healthy.example/older',
          description: null,
          publishedAt: new Date('2026-10-02T00:00:00.000Z'),
        },
        {
          guid: 'newer',
          title: 'Newer article',
          link: 'https://healthy.example/newer',
          description: null,
          publishedAt: new Date('2026-10-03T00:00:00.000Z'),
        },
        {
          guid: 'undated',
          title: 'Undated article',
          link: 'https://healthy.example/undated',
          description: null,
          publishedAt: null,
        },
      ],
    });

    await service.syncSubscribedFeeds();

    const insertedArticles = transaction.article.createMany.mock.calls[0][0].data;
    expect(insertedArticles.map((article: { guid: string }) => article.guid)).toEqual([
      'newer',
      'older',
      'undated',
    ]);
  });

  it('成功同步原本錯誤的 Feed 時回傳復原事件', async () => {
    const failedFeed = { ...subscribedFeeds[1], status: 'ERROR' };
    prisma.feed.findMany.mockResolvedValue([failedFeed]);
    feedFetcher.fetchAndParse.mockReset().mockResolvedValue({
      url: failedFeed.url,
      title: 'Recovered Feed',
      description: null,
      siteUrl: null,
      items: [],
    });

    await expect(service.syncSubscribedFeeds()).resolves.toEqual({
      feeds: 1,
      succeeded: 1,
      failed: 0,
      newArticles: 0,
      feedFailures: [],
      recoveredFeeds: [{ feedId: '2', durationMs: expect.any(Number) }],
    });
  });

  it('將 response 超限分類並記錄後繼續同步其他 Feed', async () => {
    feedFetcher.fetchAndParse.mockReset()
      .mockRejectedValueOnce(new FeedResponseTooLargeException())
      .mockResolvedValueOnce({
        url: subscribedFeeds[1].url,
        title: 'Healthy Feed',
        description: null,
        siteUrl: null,
        items: [],
      });

    const summary = await service.syncSubscribedFeeds();

    expect(summary).toEqual({
      feeds: 2,
      succeeded: 1,
      failed: 1,
      newArticles: 0,
      feedFailures: [{
        feedId: '1',
        errorType: 'FeedResponseTooLargeException',
        durationMs: expect.any(Number),
      }],
      recoveredFeeds: [],
    });
    expect(prisma.feed.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: {
        status: 'ERROR',
        lastError: 'Feed response is too large.',
        lastErrorAt: expect.any(Date),
      },
    });
  });

  it('將 SSRF 拒絕分類並繼續同步其他 Feed', async () => {
    feedFetcher.fetchAndParse.mockReset()
      .mockRejectedValueOnce(new FeedSsrfBlockedException())
      .mockResolvedValueOnce({
        url: subscribedFeeds[1].url,
        title: 'Healthy Feed',
        description: null,
        siteUrl: null,
        items: [],
      });

    const summary = await service.syncSubscribedFeeds();

    expect(summary.feedFailures).toEqual([{
      feedId: '1',
      errorType: 'FeedSsrfBlockedException',
      durationMs: expect.any(Number),
    }]);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
  });
});