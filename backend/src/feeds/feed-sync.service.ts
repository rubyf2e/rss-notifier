import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeedFetcherService } from './feed-fetcher.service';

export interface FeedSyncSummary {
  feeds: number;
  succeeded: number;
  failed: number;
  newArticles: number;
  feedFailures: Array<{ feedId: string; errorType: string; durationMs: number }>;
  recoveredFeeds: Array<{ feedId: string; durationMs: number }>;
}

function classifyError(error: unknown): string {
  if (error instanceof BadRequestException) {
    return 'BadRequestException';
  }
  return error instanceof Error ? 'Error' : 'Unknown';
}

@Injectable()
export class FeedSyncService {
  private readonly logger = new Logger(FeedSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feedFetcher: FeedFetcherService,
  ) {}

  async syncSubscribedFeeds(): Promise<FeedSyncSummary> {
    const feeds = await this.prisma.feed.findMany({
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
    let succeeded = 0;
    let failed = 0;
    let newArticles = 0;
    const feedFailures: FeedSyncSummary['feedFailures'] = [];
    const recoveredFeeds: FeedSyncSummary['recoveredFeeds'] = [];

    for (const feed of feeds) {
      const startedAt = Date.now();
      try {
        const parsedFeed = await this.feedFetcher.fetchAndParse(feed.url);
        const syncedAt = new Date();
        const firstSeenAt = feed.initialSyncCompleted ? syncedAt : feed.createdAt;

        const insertedCount = await this.prisma.$transaction(async (transaction) => {
          let count = 0;
          if (parsedFeed.items.length > 0) {
            const result = await transaction.article.createMany({
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
            count = result.count;
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
          return count;
        });
        newArticles += insertedCount;
        succeeded += 1;
        if (feed.status === 'ERROR') {
          recoveredFeeds.push({
            feedId: String(feed.id),
            durationMs: Date.now() - startedAt,
          });
        }
      } catch (error) {
        failed += 1;
        feedFailures.push({
          feedId: String(feed.id),
          errorType: classifyError(error),
          durationMs: Date.now() - startedAt,
        });
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
          this.logger.error(
            `無法更新 Feed ${feed.id} 的錯誤狀態 errorType=${classifyError(updateError)}`,
          );
        }
      }
    }

    return {
      feeds: feeds.length,
      succeeded,
      failed,
      newArticles,
      feedFailures,
      recoveredFeeds,
    };
  }
}