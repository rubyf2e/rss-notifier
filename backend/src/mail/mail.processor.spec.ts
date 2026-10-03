import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MailProcessor } from './mail.processor';
import {
  MailJobData,
  SEND_ARTICLE_NOTIFICATION_EMAIL_JOB,
  SEND_MAGIC_LINK_EMAIL_JOB,
  SendMagicLinkEmailJobData,
} from './mail.constants';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('MailProcessor', () => {
  let processor: MailProcessor;
  let mailerService: { sendMail: jest.Mock };
  let prisma: {
    notificationLog: { findUnique: jest.Mock; updateMany: jest.Mock; update: jest.Mock };
    subscription: { update: jest.Mock };
  };
  let configService: { getOrThrow: jest.Mock };

  const notificationLog = {
    id: 22n,
    subscriptionId: 8n,
    status: 'PENDING',
    subscription: {
      id: 8n,
      publicId: 'subscription-public-id',
      status: 'ACTIVE',
      user: { email: 'reader@example.com' },
    },
    article: {
      title: 'A new article',
      link: 'https://feed.example/articles/1',
      feed: { title: 'Example Feed', url: 'https://feed.example/rss' },
    },
  };

  beforeEach(() => {
    mailerService = { sendMail: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      notificationLog: {
        findUnique: jest.fn().mockResolvedValue(notificationLog),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      subscription: { update: jest.fn().mockResolvedValue({}) },
    };
    configService = {
      getOrThrow: jest.fn((key: string) => ({
        JWT_SECRET: 'test-secret',
        BACKEND_URL: 'https://api.example',
      })[key]),
    };
    processor = new MailProcessor(
      mailerService as unknown as MailerService,
      prisma as unknown as PrismaService,
      configService as unknown as ConfigService,
    );
  });

  it('取得 BullMQ job、渲染登入模板並呼叫 MailerService', async () => {
    const jobData: SendMagicLinkEmailJobData = {
      recipientEmail: 'user@example.com',
      loginUrl: 'https://frontend.example/auth/verify?token=secure-token',
    };
    const job = {
      name: SEND_MAGIC_LINK_EMAIL_JOB,
      data: jobData,
    } as Job<MailJobData>;

    await processor.process(job);

    expect(mailerService.sendMail).toHaveBeenCalledWith({
      to: jobData.recipientEmail,
      subject: 'Your login link',
      html: expect.stringContaining(jobData.loginUrl),
    });
  });

  it('寄送新文章通知並將通知紀錄標記為 SENT', async () => {
    const job = {
      name: SEND_ARTICLE_NOTIFICATION_EMAIL_JOB,
      data: { notificationLogId: '22' },
      attemptsMade: 0,
    } as Job<MailJobData>;

    await processor.process(job);

    expect(mailerService.sendMail).toHaveBeenCalledWith({
      to: 'reader@example.com',
      subject: 'New article from Example Feed: A new article',
      html: expect.stringContaining('A new article'),
    });
    const email = mailerService.sendMail.mock.calls[0][0];
    expect(email.html).toContain('https://feed.example/articles/1');
    expect(email.html).toContain('/subscriptions/unsubscribe?token&#x3D;');
    expect(prisma.notificationLog.update).toHaveBeenCalledWith({
      where: { id: 22n },
      data: expect.objectContaining({ status: 'SENT', sentAt: expect.any(Date) }),
    });
  });

  it('寄送失敗時保留 PENDING、增加重試次數並設定下次重試時間', async () => {
    const failure = new Error('SMTP unavailable');
    mailerService.sendMail.mockRejectedValue(failure);
    const job = {
      name: SEND_ARTICLE_NOTIFICATION_EMAIL_JOB,
      data: { notificationLogId: '22' },
      attemptsMade: 0,
    } as Job<MailJobData>;

    await expect(processor.process(job)).rejects.toBe(failure);

    expect(prisma.notificationLog.update).toHaveBeenCalledWith({
      where: { id: 22n },
      data: expect.objectContaining({
        status: 'PENDING',
        retryCount: { increment: 1 },
        errorMessage: 'SMTP unavailable',
        nextRetryAt: expect.any(Date),
      }),
    });
  });

  it('達到 BullMQ 重試上限後記錄 FAILED 與錯誤', async () => {
    const job = {
      name: SEND_ARTICLE_NOTIFICATION_EMAIL_JOB,
      data: { notificationLogId: '22' },
      attemptsMade: 5,
      opts: { attempts: 5 },
    } as Job<MailJobData>;

    await processor.handleFailedJob(job, new Error('SMTP unavailable'));

    expect(prisma.notificationLog.updateMany).toHaveBeenCalledWith({
      where: { id: 22n, status: { in: ['PENDING', 'PROCESSING'] } },
      data: {
        status: 'FAILED',
        failedAt: expect.any(Date),
        nextRetryAt: null,
        errorMessage: 'SMTP unavailable',
      },
    });
  });

  it('暫停訂閱時略過尚未寄出的通知', async () => {
    prisma.notificationLog.findUnique.mockResolvedValue({
      ...notificationLog,
      subscription: { ...notificationLog.subscription, status: 'PAUSED' },
    });
    const job = {
      name: SEND_ARTICLE_NOTIFICATION_EMAIL_JOB,
      data: { notificationLogId: '22' },
      attemptsMade: 0,
    } as Job<MailJobData>;

    await processor.process(job);

    expect(mailerService.sendMail).not.toHaveBeenCalled();
    expect(prisma.notificationLog.update).toHaveBeenCalledWith({
      where: { id: 22n },
      data: { status: 'SKIPPED', nextRetryAt: null },
    });
  });
});