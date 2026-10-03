import { Injectable, Logger } from '@nestjs/common';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const SCHEDULER_LOG_DIRECTORY = '/app/logs';

export interface SchedulerRunLog {
  schedulerName: string;
  startedAt: string;
  completedAt: string;
  status: 'success' | 'failure' | 'skipped';
  durationMs: number;
  deletedCount?: number;
  skipReason?: 'INTERVAL_NOT_REACHED';
  elapsedMs?: number;
  feedSync?: {
    feeds: number;
    succeeded: number;
    failed: number;
    newArticles: number;
    notificationsCreated?: number;
    feedFailures: Array<{ feedId: string; errorType: string; durationMs: number }>;
    recoveredFeeds: Array<{ feedId: string; durationMs: number }>;
  };
  error?: {
    message: string;
    stack: string;
  };
}

export function getSchedulerLogFilePath(
  entry: Pick<SchedulerRunLog, 'schedulerName' | 'startedAt'>,
  logDirectory = SCHEDULER_LOG_DIRECTORY,
): string {
  const date = entry.startedAt.slice(0, 10);
  const schedulerName = entry.schedulerName.replace(/[^A-Za-z0-9_-]/g, '_');
  return join(logDirectory, `${date}-${schedulerName}.txt`);
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(password|passwd|secret|token|authorization|magic[_ -]?link)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1=[REDACTED]',
    )
    .replace(/(postgres(?:ql)?|redis):\/\/[^/@\s]+@/gi, '$1://[REDACTED]@');
}

function formatRunLog(entry: SchedulerRunLog): string {
  const parts = [
    `${entry.completedAt} scheduler=${entry.schedulerName}`,
    `status=${entry.status}`,
    `startedAt=${entry.startedAt}`,
    `durationMs=${entry.durationMs}`,
  ];

  if (entry.deletedCount !== undefined) {
    parts.push(`deletedCount=${entry.deletedCount}`);
  }
  if (entry.skipReason) {
    parts.push(`skipReason=${entry.skipReason}`);
  }
  if (entry.elapsedMs !== undefined) {
    parts.push(`elapsedMs=${entry.elapsedMs}`);
  }
  if (entry.feedSync) {
    const { feedSync } = entry;
    parts.push(
      `feeds=${feedSync.feeds}`,
      `succeeded=${feedSync.succeeded}`,
      `failed=${feedSync.failed}`,
      `newArticles=${feedSync.newArticles}`,
    );
    if (feedSync.notificationsCreated !== undefined) {
      parts.push(`notificationsCreated=${feedSync.notificationsCreated}`);
    }
    if (feedSync.feedFailures.length > 0) {
      parts.push(`feedFailures=${feedSync.feedFailures.map(({ feedId, errorType, durationMs }) =>
        `${feedId}:${errorType}:${durationMs}ms`).join(',')}`);
    }
    if (feedSync.recoveredFeeds.length > 0) {
      parts.push(`recoveredFeeds=${feedSync.recoveredFeeds.map(({ feedId, durationMs }) =>
        `${feedId}:${durationMs}ms`).join(',')}`);
    }
  }
  if (entry.error) {
    parts.push(`error=${JSON.stringify(redactSensitiveText(entry.error.message))}`);
    parts.push(`stack=${JSON.stringify(redactSensitiveText(entry.error.stack))}`);
  }

  return `${parts.join(' ')}\n`;
}

@Injectable()
export class PersistentSchedulerLogger {
  private readonly logger = new Logger(PersistentSchedulerLogger.name);

  async append(
    entry: SchedulerRunLog,
    filePath = getSchedulerLogFilePath(entry),
  ): Promise<void> {
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await appendFile(filePath, formatRunLog(entry), {
        encoding: 'utf8',
        flag: 'a',
        mode: 0o640,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`無法寫入 Scheduler log：${redactSensitiveText(message)}`);
    }
  }
}