import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeedFetcherService } from '../feeds/feed-fetcher.service';
import { hashUnsubscribeToken } from './unsubscribe-token';

const ACTIVE = 'ACTIVE';
const PAUSED = 'PAUSED';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feedFetcher: FeedFetcherService,
  ) {}

  async create(userPublicId: string, inputUrl: string) {
    const userId = await this.getUserId(userPublicId);
    const parsedFeed = await this.feedFetcher.fetchAndParse(inputUrl);

    try {
      const subscription = await this.prisma.$transaction(async (transaction) => {
        const syncedAt = new Date();
        const feed = await transaction.feed.upsert({
          where: { url: parsedFeed.url },
          create: {
            url: parsedFeed.url,
            title: parsedFeed.title,
            description: parsedFeed.description,
            siteUrl: parsedFeed.siteUrl,
            status: 'HEALTHY',
            initialSyncCompleted: true,
            lastSyncedAt: syncedAt,
          },
          update: {
            title: parsedFeed.title,
            description: parsedFeed.description,
            siteUrl: parsedFeed.siteUrl,
            status: 'HEALTHY',
            initialSyncCompleted: true,
            lastSyncedAt: syncedAt,
            lastError: null,
            lastErrorAt: null,
          },
        });
        if (parsedFeed.items.length > 0) {
          await transaction.article.createMany({
            data: parsedFeed.items.map((article) => ({
              feedId: feed.id,
              guid: article.guid,
              title: article.title,
              link: article.link,
              description: article.description,
              publishedAt: article.publishedAt,
              firstSeenAt: syncedAt,
            })),
            skipDuplicates: true,
          });
        }
        const unsubscribeToken = randomBytes(32).toString('hex');

        return transaction.subscription.create({
          data: {
            userId,
            feedId: feed.id,
            status: ACTIVE,
            unsubscribeTokenHash: createHash('sha256').update(unsubscribeToken).digest('hex'),
            statusHistory: { create: { status: ACTIVE } },
          },
          include: { feed: true },
        });
      });

      return this.toResponse(subscription);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('This feed is already subscribed.');
      }
      throw error;
    }
  }

  async list(userPublicId: string, page: number, limit: number) {
    const userId = await this.getUserId(userPublicId);
    const where = { userId };
    const [subscriptions, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        include: { feed: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.subscription.count({ where }),
    ]);

    return {
      items: subscriptions.map((subscription) => this.toResponse(subscription)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async pause(userPublicId: string, subscriptionPublicId: string) {
    return this.updateStatus(userPublicId, subscriptionPublicId, PAUSED);
  }

  async resume(userPublicId: string, subscriptionPublicId: string) {
    return this.updateStatus(userPublicId, subscriptionPublicId, ACTIVE);
  }

  async remove(userPublicId: string, subscriptionPublicId: string): Promise<void> {
    const userId = await this.getUserId(userPublicId);
    await this.prisma.$transaction(async (transaction) => {
      const subscription = await transaction.subscription.findFirst({
        where: { publicId: subscriptionPublicId, userId },
        select: { id: true },
      });

      if (!subscription) {
        throw new NotFoundException('Subscription not found.');
      }

      await transaction.subscription.delete({ where: { id: subscription.id } });
    });
  }

  async unsubscribe(token: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(token)) {
      throw new BadRequestException('Unsubscribe link is invalid.');
    }

    const unsubscribeTokenHash = hashUnsubscribeToken(token);
    await this.prisma.$transaction(async (transaction) => {
      const subscription = await transaction.subscription.findUnique({
        where: { unsubscribeTokenHash },
        select: { id: true, status: true },
      });

      if (!subscription) {
        throw new BadRequestException('Unsubscribe link is invalid.');
      }
      if (subscription.status === 'UNSUBSCRIBED') {
        return;
      }

      await transaction.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'UNSUBSCRIBED',
          statusHistory: { create: { status: 'UNSUBSCRIBED' } },
        },
      });
    });
  }

  private async updateStatus(
    userPublicId: string,
    subscriptionPublicId: string,
    status: typeof ACTIVE | typeof PAUSED,
  ) {
    const userId = await this.getUserId(userPublicId);

    const subscription = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.subscription.findFirst({
        where: { publicId: subscriptionPublicId, userId },
        select: { id: true, status: true },
      });

      if (!existing) {
        throw new NotFoundException('Subscription not found.');
      }
      if (existing.status === status) {
        return transaction.subscription.findUniqueOrThrow({
          where: { id: existing.id },
          include: { feed: true },
        });
      }

      return transaction.subscription.update({
        where: { id: existing.id },
        data: {
          status,
          statusHistory: { create: { status } },
        },
        include: { feed: true },
      });
    });

    return this.toResponse(subscription);
  }

  private async getUserId(userPublicId: string): Promise<bigint> {
    const user = await this.prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: { id: true },
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists.');
    }
    return user.id;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }

  private toResponse(subscription: {
    publicId: string;
    status: string;
    createdAt: Date;
    feed: {
      title: string | null;
      url: string;
      status: string;
      lastSyncedAt: Date | null;
      lastError: string | null;
    };
  }) {
    return {
      id: subscription.publicId,
      status: subscription.status,
      createdAt: subscription.createdAt,
      feed: {
        title: subscription.feed.title ?? subscription.feed.url,
        url: subscription.feed.url,
        status: subscription.feed.status,
        lastSyncedAt: subscription.feed.lastSyncedAt,
        lastError: subscription.feed.lastError,
      },
    };
  }
}