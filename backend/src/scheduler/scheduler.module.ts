import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { FeedsModule } from '../feeds/feeds.module';
import { MailModule } from '../mail/mail.module';
import { FeedSyncScheduler } from './feed-sync.scheduler';
import { MagicLinkCleanupScheduler } from './magic-link-cleanup.scheduler';
import { PersistentSchedulerLogger } from './persistent-scheduler-logger.service';

@Module({
  imports: [ScheduleModule.forRoot(), FeedsModule, MailModule],
  providers: [
    FeedSyncScheduler,
    MagicLinkCleanupScheduler,
    PersistentSchedulerLogger,
  ],
})
export class SchedulerModule {}