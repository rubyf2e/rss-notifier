import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FeedsModule } from '../feeds/feeds.module';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [AuthModule, FeedsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
})
export class SubscriptionsModule {}