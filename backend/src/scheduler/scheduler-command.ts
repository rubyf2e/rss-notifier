import { INestApplicationContext, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppModule } from '../app.module';
import { ArticleCleanupScheduler } from './article-cleanup.scheduler';
import { FeedSyncScheduler } from './feed-sync.scheduler';
import { MagicLinkCleanupScheduler } from './magic-link-cleanup.scheduler';

type SchedulerTask = (app: INestApplicationContext) => Promise<unknown>;

const schedulerTasks: Record<string, SchedulerTask> = {
  'feed-sync': async (app) =>
    app.get(FeedSyncScheduler, { strict: false }).syncIfDue(),
  'article-cleanup': async (app) =>
    app.get(ArticleCleanupScheduler, { strict: false }).cleanupOldArticles(),
  'magic-link-cleanup': async (app) =>
    app.get(MagicLinkCleanupScheduler, { strict: false }).cleanupExpiredMagicLinks(),
};

export async function runSchedulerCommand(command: string | undefined): Promise<number> {
  const task = command ? schedulerTasks[command] : undefined;
  const logger = new Logger('SchedulerCommand');
  let app: INestApplicationContext | undefined;
  let exitCode = 0;

  if (!task) {
    logger.error(`Unknown scheduler command: ${command ?? '(missing)'}`);
    return 1;
  }

  try {
    app = await NestFactory.createApplicationContext(AppModule);
    const schedulerRegistry = app.get(SchedulerRegistry, { strict: false });
    for (const cronJob of schedulerRegistry.getCronJobs().values()) {
      const stopResult = cronJob.stop();
      if (stopResult) {
        await stopResult;
      }
    }
    await task(app);
  } catch (error) {
    exitCode = 1;
    const errorType = error instanceof Error ? error.name : 'Unknown';
    logger.error(`Scheduler command failed: ${command} errorType=${errorType}`);
  } finally {
    if (app) {
      try {
        await app.close();
      } catch (error) {
        exitCode = 1;
        const errorType = error instanceof Error ? error.name : 'Unknown';
        logger.error(`Scheduler application context close failed errorType=${errorType}`);
      }
    }
  }

  return exitCode;
}

if (require.main === module) {
  void runSchedulerCommand(process.argv[2]).then((exitCode) => {
    process.exitCode = exitCode;
  });
}