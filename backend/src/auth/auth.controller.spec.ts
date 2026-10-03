import { ValidationPipe } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MAIL_QUEUE, SEND_MAGIC_LINK_EMAIL_JOB } from '../mail/mail.constants';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('登入 API 控制器', () => {
  let app: INestApplication;
  let authService: { requestMagicLink: jest.Mock; verifyMagicLink: jest.Mock };

  beforeEach(async () => {
    authService = {
      requestMagicLink: jest.fn().mockResolvedValue({
        message: 'If this email can be used, a login link has been sent.',
      }),
      verifyMagicLink: jest.fn().mockResolvedValue({
        accessToken: 'signed.jwt.token',
        user: { id: 'user-1', email: 'user@example.com' },
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('接受有效的登入連結請求，且不洩漏帳號是否存在', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/magic-link')
      .send({ email: 'user@example.com' })
      .expect(202)
      .expect({ message: 'If this email can be used, a login link has been sent.' });
    expect(authService.requestMagicLink).toHaveBeenCalledWith('user@example.com');
  });

  it('驗證請求中的電子郵件格式', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/magic-link')
      .send({ email: 'not-an-email' })
      .expect(400);
    expect(authService.requestMagicLink).not.toHaveBeenCalled();
  });

  it('驗證查詢參數中的 token 並回傳登入使用者', async () => {
    await request(app.getHttpServer())
      .get('/api/auth/magic-link/verify')
      .query({ token: 'opaque-token' })
      .expect(200)
      .expect({
        accessToken: 'signed.jwt.token',
        user: { id: 'user-1', email: 'user@example.com' },
      });
    expect(authService.verifyMagicLink).toHaveBeenCalledWith('opaque-token');
  });
});

describe('登入連結 API 的 Queue 整合', () => {
  it('POST 成功後加入只含收件者與登入 URL 的 mail job', async () => {
    const user = { id: 1n, publicId: 'user-public-1', email: 'user@example.com' };
    const prisma = {
      user: { upsert: jest.fn().mockResolvedValue(user) },
      magicLink: { create: jest.fn().mockResolvedValue({}) },
    };
    const mailQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    const configValues: Record<string, string> = {
      MAGIC_LINK_TTL_MINUTES: '15',
      FRONTEND_URL: 'https://frontend.example',
    };
    const configService = {
      get: jest.fn((key: string) => configValues[key]),
      getOrThrow: jest.fn((key: string) => configValues[key]),
    };
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { signAsync: jest.fn() } },
        { provide: ConfigService, useValue: configService },
        { provide: getQueueToken(MAIL_QUEUE), useValue: mailQueue },
      ],
    }).compile();
    const app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    try {
      await request(app.getHttpServer())
        .post('/api/auth/magic-link')
        .send({ email: user.email })
        .expect(202)
        .expect({ message: 'If this email can be used, a login link has been sent.' });

      const [jobName, jobData] = mailQueue.add.mock.calls[0];
      expect(jobName).toBe(SEND_MAGIC_LINK_EMAIL_JOB);
      expect(jobData).toEqual({
        recipientEmail: user.email,
        loginUrl: expect.stringMatching(
          /^https:\/\/frontend\.example\/auth\/verify\?token=[a-f0-9]{64}$/,
        ),
      });
      expect(Object.keys(jobData).sort()).toEqual(['loginUrl', 'recipientEmail']);
    } finally {
      await app.close();
    }
  });
});
