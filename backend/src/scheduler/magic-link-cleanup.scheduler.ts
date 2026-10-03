import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  PersistentSchedulerLogger,
  SchedulerRunLog,
} from './persistent-scheduler-logger.service';

@Injectable()
export class MagicLinkCleanupScheduler {
  private readonly logger = new Logger(MagicLinkCleanupScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerLogger: PersistentSchedulerLogger,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupExpiredMagicLinks(): Promise<number> {
    const startedAt = new Date();

    try {
      const { count } = await this.prisma.magicLink.deleteMany({
        where: {
          usedAt: null,
          expiresAt: { lt: new Date() },
        },
      });
      const completedAt = new Date();

      await this.appendRunLog({
        schedulerName: MagicLinkCleanupScheduler.name,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        status: 'success',
        durationMs: completedAt.getTime() - startedAt.getTime(),
        deletedCount: count,
      });
      this.logger.log(`已清理 ${count} 筆過期且未使用的 MagicLink`);
      return count;
    } catch (error) {
      const completedAt = new Date();
      const details = error instanceof Error
        ? { message: error.message, stack: error.stack ?? error.message }
        : { message: String(error), stack: String(error) };

      await this.appendRunLog({
        schedulerName: MagicLinkCleanupScheduler.name,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        status: 'failure',
        durationMs: completedAt.getTime() - startedAt.getTime(),
        error: details,
      });
      throw error;
    }
  }

  private async appendRunLog(entry: SchedulerRunLog): Promise<void> {
    try {
      await this.schedulerLogger.append(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`無法寫入 Scheduler log：${message}`);
    }
  }
}