import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeedFetcherService } from './feed-fetcher.service';

@Injectable()
export class FeedSyncService {
  private readonly logger = new Logger(FeedSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feedFetcher: FeedFetcherService,
  ) {}

  async syncSubscribedFeeds(): Promise<{ succeeded: number; failed: number }> {
    const feeds = await this.prisma.feed.findMany({
      where: { subscriptions: { some: {} } },
      select: {
        id: true,
        url: true,
        initialSyncCompleted: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
    });
    let succeeded = 0;
    let failed = 0;

    for (const feed of feeds) {
      try {
        const parsedFeed = await this.feedFetcher.fetchAndParse(feed.url);
        const syncedAt = new Date();
        const firstSeenAt = feed.initialSyncCompleted ? syncedAt : feed.createdAt;

        await this.prisma.$transaction(async (transaction) => {
          if (parsedFeed.items.length > 0) {
            await transaction.article.createMany({
              data: parsedFeed.items.map((article) => ({
                feedId: feed.id,
                guid: article.guid,
                title: article.title,
                link: article.link,
                description: article.description,
                publishedAt: article.publishedAt,
                firstSeenAt,
              })),
              skipDuplicates: true,
            });
          }

          await transaction.feed.update({
            where: { id: feed.id },
            data: {
              title: parsedFeed.title,
              description: parsedFeed.description,
              siteUrl: parsedFeed.siteUrl,
              initialSyncCompleted: true,
              lastSyncedAt: syncedAt,
              lastError: null,
              lastErrorAt: null,
              status: 'HEALTHY',
            },
          });
        });
        succeeded += 1;
      } catch (error) {
        failed += 1;
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
        try {
          await this.prisma.feed.update({
            where: { id: feed.id },
            data: {
              status: 'ERROR',
              lastError: message,
              lastErrorAt: new Date(),
            },
          });
        } catch (updateError) {
          const updateMessage = updateError instanceof Error
            ? updateError.message
            : String(updateError);
          this.logger.error(`無法更新 Feed ${feed.id} 的錯誤狀態：${updateMessage}`);
        }
      }
    }

    return { succeeded, failed };
  }
}