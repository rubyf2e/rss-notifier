import { Logger } from '@nestjs/common';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getSchedulerLogFilePath,
  PersistentSchedulerLogger,
  SchedulerRunLog,
} from './persistent-scheduler-logger.service';

describe('PersistentSchedulerLogger', () => {
  let logger: PersistentSchedulerLogger;

  beforeEach(() => {
    logger = new PersistentSchedulerLogger();
  });

  it('依開始日期和 scheduler 名稱產生獨立文字檔路徑', () => {
    const logDirectory = '/tmp/scheduler-logs';

    expect(getSchedulerLogFilePath({
      schedulerName: 'FeedSyncScheduler',
      startedAt: '2026-10-04T00:00:00.000Z',
    }, logDirectory)).toBe(join(logDirectory, '2026-10-04-FeedSyncScheduler.txt'));
    expect(getSchedulerLogFilePath({
      schedulerName: 'MagicLinkCleanupScheduler',
      startedAt: '2026-10-04T00:00:00.000Z',
    }, logDirectory)).toBe(join(logDirectory, '2026-10-04-MagicLinkCleanupScheduler.txt'));
    expect(getSchedulerLogFilePath({
      schedulerName: 'FeedSyncScheduler',
      startedAt: '2026-10-05T00:00:00.000Z',
    }, logDirectory)).toBe(join(logDirectory, '2026-10-05-FeedSyncScheduler.txt'));
  });

  it('自動建立目錄並以純文字 append 多筆排程紀錄，同時遮蔽敏感字串', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'scheduler-log-'));
    const filePath = join(directory, 'nested', 'scheduler.txt');
    const entry: SchedulerRunLog = {
      schedulerName: 'MagicLinkCleanupScheduler',
      startedAt: '2026-10-02T00:00:00.000Z',
      completedAt: '2026-10-02T00:00:01.000Z',
      status: 'failure',
      durationMs: 1000,
      error: {
        message: 'Authorization: Bearer sample-token password=sample-password',
        stack: 'Error: token=sample-token',
      },
    };

    try {
      await logger.append(entry, filePath);
      await logger.append({ ...entry, status: 'success', error: undefined }, filePath);

      const lines = (await readFile(filePath, 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('scheduler=MagicLinkCleanupScheduler status=failure');
      expect(lines[0]).toContain('error="Authorization=[REDACTED] [REDACTED] password=[REDACTED]"');
      expect(lines[0]).toContain('stack="Error: token=[REDACTED]"');
      expect(lines[1]).toContain('status=success');
      expect(lines.join('\n')).not.toContain('sample-token');
      expect(lines.join('\n')).not.toContain('sample-password');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('檔案寫入失敗時不向呼叫端拋出錯誤', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'scheduler-log-'));
    const blockerPath = join(directory, 'blocker');
    await writeFile(blockerPath, 'file prevents directory creation');
    const loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const entry: SchedulerRunLog = {
      schedulerName: 'MagicLinkCleanupScheduler',
      startedAt: '2026-10-02T00:00:00.000Z',
      completedAt: '2026-10-02T00:00:01.000Z',
      status: 'success',
      durationMs: 1000,
    };

    try {
      await expect(logger.append(entry, join(blockerPath, 'scheduler.txt'))).resolves.toBeUndefined();
      expect(loggerError).toHaveBeenCalled();
    } finally {
      loggerError.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
});