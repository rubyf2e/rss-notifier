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
    subscription: { findMany: jest.Mock };
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
      subscription: { findMany: jest.fn().mockResolvedValue([subscription]) },
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

  it('清單查詢只包含目前使用者並可安全序列化', async () => {
    const result = await service.list('user-a');

    expect(prisma.subscription.findMany).toHaveBeenCalledWith({
      where: { userId: 42n },
      include: { feed: true },
      orderBy: { createdAt: 'desc' },
    });
    expect(() => JSON.stringify(result)).not.toThrow();
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