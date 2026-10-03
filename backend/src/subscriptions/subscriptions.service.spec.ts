import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeedFetcherService } from '../feeds/feed-fetcher.service';
import { SubscriptionsService } from './subscriptions.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('訂閱服務', () => {
  let service: SubscriptionsService;
  let prisma: {
    user: { findUnique: jest.Mock };
    subscription: { findMany: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };
  let transaction: {
    feed: { upsert: jest.Mock };
    article: { createMany: jest.Mock };
    subscription: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let feedFetcher: { fetchAndParse: jest.Mock };

  const feed = {
    id: 12n,
    title: '測試 Feed',
    url: 'http://8.8.8.8/feed.xml',
    status: 'HEALTHY',
    lastSyncedAt: new Date('2026-10-03T00:00:00.000Z'),
    lastError: null,
  };
  const subscription = {
    publicId: 'subscription-public-id',
    status: 'ACTIVE',
    createdAt: new Date('2026-10-03T00:00:00.000Z'),
    feed,
  };
  const parsedFeed = {
    url: feed.url,
    title: feed.title,
    description: 'feed description',
    siteUrl: 'https://site.example',
    items: [{
      guid: 'article-1',
      title: '既有文章',
      link: 'https://site.example/article-1',
      description: '文章摘要',
      publishedAt: new Date('2026-10-02T00:00:00.000Z'),
    }],
  };

  beforeEach(() => {
    transaction = {
      feed: { upsert: jest.fn().mockResolvedValue(feed) },
      article: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      subscription: {
        create: jest.fn().mockResolvedValue(subscription),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue(subscription),
        update: jest.fn().mockResolvedValue({ ...subscription, status: 'PAUSED' }),
        delete: jest.fn().mockResolvedValue(subscription),
      },
    };
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 42n }) },
      subscription: {
        findMany: jest.fn().mockResolvedValue([subscription]),
        count: jest.fn().mockResolvedValue(23),
      },
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    feedFetcher = { fetchAndParse: jest.fn().mockResolvedValue(parsedFeed) };
    service = new SubscriptionsService(
      prisma as unknown as PrismaService,
      feedFetcher as unknown as FeedFetcherService,
    );
  });

  it('解析有效 Feed 後建立自己的訂閱並回傳清單所需狀態', async () => {
    const result = await service.create('user-a', 'http://8.8.8.8/feed.xml#latest');

    expect(result).toEqual({
      id: subscription.publicId,
      status: 'ACTIVE',
      createdAt: subscription.createdAt,
      feed: {
        title: '測試 Feed',
        url: feed.url,
        status: 'HEALTHY',
        lastSyncedAt: expect.any(Date),
        lastError: null,
      },
    });
    expect(transaction.feed.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { url: feed.url },
      create: expect.objectContaining({
        title: '測試 Feed',
        status: 'HEALTHY',
        initialSyncCompleted: true,
      }),
    }));
    expect(transaction.article.createMany).toHaveBeenCalledWith({
      data: [{
        feedId: feed.id,
        guid: 'article-1',
        title: '既有文章',
        link: 'https://site.example/article-1',
        description: '文章摘要',
        publishedAt: parsedFeed.items[0].publishedAt,
        firstSeenAt: expect.any(Date),
      }],
      skipDuplicates: true,
    });
    const createCall = transaction.subscription.create.mock.calls[0][0];
    expect(createCall.data.userId).toBe(42n);
    expect(createCall.data.statusHistory).toEqual({ create: { status: 'ACTIVE' } });
    expect(createCall.data.unsubscribeTokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('拒絕無法解析為 RSS 或 Atom 的內容', async () => {
    feedFetcher.fetchAndParse.mockRejectedValue(
      new BadRequestException('URL does not contain a valid RSS or Atom feed.'),
    );

    await expect(service.create('user-a', 'http://8.8.8.8/page')).rejects.toThrow(
      'URL does not contain a valid RSS or Atom feed.',
    );
    expect(transaction.subscription.create).not.toHaveBeenCalled();
  });

  it('將重複訂閱唯一限制轉換為明確衝突回應', async () => {
    transaction.subscription.create.mockRejectedValue({ code: 'P2002' });

    await expect(service.create('user-a', 'http://8.8.8.8/feed.xml')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('清單查詢只包含目前使用者、維持排序並回傳預設分頁資料', async () => {
    const result = await service.list('user-a', 1, 20);

    expect(prisma.subscription.findMany).toHaveBeenCalledWith({
      where: { userId: 42n },
      include: { feed: true },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
    expect(prisma.subscription.count).toHaveBeenCalledWith({
      where: { userId: 42n },
    });
    expect(result).toEqual({
      items: [{
        id: subscription.publicId,
        status: subscription.status,
        createdAt: subscription.createdAt,
        feed: {
          title: feed.title,
          url: feed.url,
          status: feed.status,
          lastSyncedAt: feed.lastSyncedAt,
          lastError: feed.lastError,
        },
      }],
      page: 1,
      limit: 20,
      total: 23,
      totalPages: 2,
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('依指定 page 與 limit 使用資料庫分頁並計算 metadata', async () => {
    prisma.subscription.findMany.mockResolvedValue([]);
    prisma.subscription.count.mockResolvedValue(11);

    const result = await service.list('user-a', 3, 5);

    expect(prisma.subscription.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 42n },
      skip: 10,
      take: 5,
    }));
    expect(result).toEqual({
      items: [],
      page: 3,
      limit: 5,
      total: 11,
      totalPages: 3,
    });
  });

  it('超過最後一頁時回傳空 items 並保留資料庫總數', async () => {
    prisma.subscription.findMany.mockResolvedValue([]);
    prisma.subscription.count.mockResolvedValue(11);

    const result = await service.list('user-a', 4, 5);

    expect(result).toEqual({
      items: [],
      page: 4,
      limit: 5,
      total: 11,
      totalPages: 3,
    });
  });

  it('暫停狀態變更限定在使用者自己的訂閱並記錄歷程', async () => {
    transaction.subscription.findFirst.mockResolvedValue({ id: 5n, status: 'ACTIVE' });

    await service.pause('user-a', 'subscription-public-id');

    expect(transaction.subscription.findFirst).toHaveBeenCalledWith({
      where: { publicId: 'subscription-public-id', userId: 42n },
      select: { id: true, status: true },
    });
    expect(transaction.subscription.update).toHaveBeenCalledWith({
      where: { id: 5n },
      data: { status: 'PAUSED', statusHistory: { create: { status: 'PAUSED' } } },
      include: { feed: true },
    });
  });

  it('無法暫停或刪除其他使用者或不存在的訂閱', async () => {
    transaction.subscription.findFirst.mockResolvedValue(null);

    await expect(service.pause('user-a', 'subscription-of-user-b')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.remove('user-a', 'subscription-of-user-b')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(transaction.subscription.delete).not.toHaveBeenCalled();
  });

  it('有效 token 會取消訂閱並記錄狀態歷程', async () => {
    transaction.subscription.findUnique.mockResolvedValue({ id: 5n, status: 'ACTIVE' });

    await expect(service.unsubscribe('a'.repeat(64))).resolves.toBeUndefined();

    expect(transaction.subscription.findUnique).toHaveBeenCalledWith({
      where: { unsubscribeTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      select: { id: true, status: true },
    });
    expect(transaction.subscription.update).toHaveBeenCalledWith({
      where: { id: 5n },
      data: {
        status: 'UNSUBSCRIBED',
        statusHistory: { create: { status: 'UNSUBSCRIBED' } },
      },
    });
  });

  it('拒絕無效或遭竄改 token 且不修改訂閱', async () => {
    transaction.subscription.findUnique.mockResolvedValue(null);

    await expect(service.unsubscribe('b'.repeat(64))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.unsubscribe('not-a-token')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(transaction.subscription.update).not.toHaveBeenCalled();
  });

  it('重複開啟有效取消連結保持冪等', async () => {
    transaction.subscription.findUnique.mockResolvedValue({
      id: 5n,
      status: 'UNSUBSCRIBED',
    });

    await expect(service.unsubscribe('c'.repeat(64))).resolves.toBeUndefined();
    expect(transaction.subscription.update).not.toHaveBeenCalled();
  });
});