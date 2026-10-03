import { Module } from '@nestjs/common';
import { FeedFetcherService } from './feed-fetcher.service';
import { FeedSyncService } from './feed-sync.service';

@Module({
  providers: [FeedFetcherService, FeedSyncService],
  exports: [FeedFetcherService, FeedSyncService],
})
export class FeedsModule {}