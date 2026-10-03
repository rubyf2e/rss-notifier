import { MailerModule } from '@nestjs-modules/mailer';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { MailProcessor } from './mail.processor';
import { NotificationService } from './notification.service';
import { MAIL_QUEUE } from './mail.constants';

@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = new URL(config.getOrThrow<string>('REDIS_URL'));

        return {
          connection: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port || 6379),
            username: redisUrl.username ? decodeURIComponent(redisUrl.username) : undefined,
            password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
            db: redisUrl.pathname.length > 1 ? Number(redisUrl.pathname.slice(1)) : undefined,
            maxRetriesPerRequest: null,
            ...(redisUrl.protocol === 'rediss:' ? { tls: {} } : {}),
          },
        };
      },
    }),
    BullModule.registerQueue({ name: MAIL_QUEUE }),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.getOrThrow<string>('MAIL_HOST'),
          port: Number(config.getOrThrow<string>('MAIL_PORT')),
          secure: config.get<string>('MAIL_SECURE') === 'true',
          auth: {
            user: config.getOrThrow<string>('MAIL_USER'),
            pass: config.getOrThrow<string>('MAIL_PASS'),
          },
        },
        defaults: {
          from: config.getOrThrow<string>('MAIL_FROM'),
        },
      }),
    }),
  ],
  providers: [MailProcessor, NotificationService],
  exports: [BullModule, NotificationService],
})
export class MailModule {}