import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Handlebars from 'handlebars';
import { PrismaService } from '../prisma/prisma.service';
import { createUnsubscribeToken, hashUnsubscribeToken } from '../subscriptions/unsubscribe-token';
import {
  MAIL_QUEUE,
  MailJobData,
  SEND_ARTICLE_NOTIFICATION_EMAIL_JOB,
  SEND_MAGIC_LINK_EMAIL_JOB,
  SendMagicLinkEmailJobData,
  SendArticleNotificationEmailJobData,
} from './mail.constants';

@Injectable()
@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  constructor(
    private readonly mailerService: MailerService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async process(job: Job<MailJobData>): Promise<void> {
    if (job.name === SEND_MAGIC_LINK_EMAIL_JOB) {
      await this.sendMagicLinkEmail(job.data as SendMagicLinkEmailJobData);
      return;
    }

    if (job.name === SEND_ARTICLE_NOTIFICATION_EMAIL_JOB) {
      await this.sendArticleNotificationEmail(
        job as Job<SendArticleNotificationEmailJobData>,
      );
      return;
    }

    throw new Error(`Unsupported mail job: ${job.name}`);
  }

  @OnWorkerEvent('failed')
  async handleFailedJob(job: Job<MailJobData> | undefined, error: Error): Promise<void> {
    if (
      !job ||
      job.name !== SEND_ARTICLE_NOTIFICATION_EMAIL_JOB ||
      job.attemptsMade < Number(job.opts.attempts ?? 1)
    ) {
      return;
    }

    const data = job.data as SendArticleNotificationEmailJobData;
    await this.prisma.notificationLog.updateMany({
      where: {
        id: BigInt(data.notificationLogId),
        status: { in: ['PENDING', 'PROCESSING'] },
      },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        nextRetryAt: null,
        errorMessage: error.message.slice(0, 2000),
      },
    });
  }

  private async sendMagicLinkEmail(data: SendMagicLinkEmailJobData): Promise<void> {
    const template = await readFile(
      join(__dirname, '../auth/templates/magic-link.hbs'),
      'utf8',
    );
    const html = Handlebars.compile(template, { strict: true })({
      loginUrl: data.loginUrl,
    });

    await this.mailerService.sendMail({
      to: data.recipientEmail,
      subject: 'Your login link',
      html,
    });
  }

  private async sendArticleNotificationEmail(
    job: Job<SendArticleNotificationEmailJobData>,
  ): Promise<void> {
    const notificationLogId = BigInt(job.data.notificationLogId);
    const notificationLog = await this.prisma.notificationLog.findUnique({
      where: { id: notificationLogId },
      include: {
        subscription: { include: { user: true } },
        article: { include: { feed: true } },
      },
    });

    if (
      !notificationLog ||
      ['SENT', 'FAILED', 'SKIPPED'].includes(notificationLog.status)
    ) {
      return;
    }

    const claim = await this.prisma.notificationLog.updateMany({
      where: { id: notificationLogId, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
    if (claim.count !== 1) {
      return;
    }

    if (notificationLog.subscription.status !== 'ACTIVE') {
      await this.prisma.notificationLog.update({
        where: { id: notificationLogId },
        data: { status: 'SKIPPED', nextRetryAt: null },
      });
      return;
    }

    try {
      const secret = this.configService.getOrThrow<string>('JWT_SECRET');
      const unsubscribeToken = createUnsubscribeToken(
        notificationLog.subscription.publicId,
        secret,
      );
      await this.prisma.subscription.update({
        where: { id: notificationLog.subscriptionId },
        data: { unsubscribeTokenHash: hashUnsubscribeToken(unsubscribeToken) },
      });

      const backendUrl = this.configService
        .getOrThrow<string>('BACKEND_URL')
        .replace(/\/+$/, '');
      const unsubscribeUrl = `${backendUrl}/api/subscriptions/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
      const template = await readFile(
        join(__dirname, 'templates/article-notification.hbs'),
        'utf8',
      );
      const feedTitle = notificationLog.article.feed.title ?? notificationLog.article.feed.url;
      const html = Handlebars.compile(template, { strict: true })({
        articleTitle: notificationLog.article.title,
        articleLink: notificationLog.article.link,
        feedTitle,
        unsubscribeUrl,
      });

      await this.mailerService.sendMail({
        to: notificationLog.subscription.user.email,
        subject: `New article from ${feedTitle}: ${notificationLog.article.title}`,
        html,
      });
      await this.prisma.notificationLog.update({
        where: { id: notificationLogId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          nextRetryAt: null,
          errorMessage: null,
        },
      });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
      const retryDelay = Math.min(60_000, 1_000 * 2 ** Math.max(0, job.attemptsMade));
      await this.prisma.notificationLog.update({
        where: { id: notificationLogId },
        data: {
          status: 'PENDING',
          retryCount: { increment: 1 },
          errorMessage: message,
          nextRetryAt: new Date(Date.now() + retryDelay),
        },
      });
      throw error;
    }
  }
}