import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { FeedFetcherService } from './feed-fetcher.service';
import { FeedSyncScheduler } from './feed-sync.scheduler';
import { FeedSyncService } from './feed-sync.service';

@Module({
  imports: [MailModule],
  providers: [FeedFetcherService, FeedSyncScheduler, FeedSyncService],
  exports: [FeedFetcherService],
})
export class FeedsModule {}