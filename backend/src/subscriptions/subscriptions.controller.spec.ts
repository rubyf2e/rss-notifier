import { ValidationPipe } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('訂閱 API 控制器', () => {
  let app: INestApplication<App>;
  let subscriptionsService: {
    create: jest.Mock;
    list: jest.Mock;
    pause: jest.Mock;
    resume: jest.Mock;
    remove: jest.Mock;
    unsubscribe: jest.Mock;
  };
  let jwtService: { verifyAsync: jest.Mock };

  beforeEach(async () => {
    subscriptionsService = {
      create: jest.fn().mockResolvedValue({ id: 'subscription-1' }),
      list: jest.fn().mockResolvedValue([]),
      pause: jest.fn().mockResolvedValue({ id: 'subscription-1', status: 'PAUSED' }),
      resume: jest.fn().mockResolvedValue({ id: 'subscription-1', status: 'ACTIVE' }),
      remove: jest.fn().mockResolvedValue(undefined),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
    };
    jwtService = {
      verifyAsync: jest.fn().mockResolvedValue({ userId: 'user-public-id' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionsController],
      providers: [
        JwtAuthGuard,
        { provide: JwtService, useValue: jwtService },
        { provide: SubscriptionsService, useValue: subscriptionsService },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('未登入時拒絕存取訂閱 API', async () => {
    await request(app.getHttpServer()).get('/subscriptions').expect(401);
    expect(subscriptionsService.list).not.toHaveBeenCalled();
  });

  it('以 JWT 身分讀取訂閱清單', async () => {
    subscriptionsService.list.mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });

    await request(app.getHttpServer())
      .get('/subscriptions')
      .set('Authorization', 'Bearer access-token')
      .expect(200)
      .expect({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('access-token');
    expect(subscriptionsService.list).toHaveBeenCalledWith('user-public-id', 1, 20);
  });

  it('將指定 page 與 limit 傳給登入者的清單查詢', async () => {
    subscriptionsService.list.mockResolvedValue({
      items: [],
      page: 2,
      limit: 7,
      total: 0,
      totalPages: 0,
    });

    await request(app.getHttpServer())
      .get('/subscriptions?page=2&limit=7')
      .set('Authorization', 'Bearer access-token')
      .expect(200)
      .expect({ items: [], page: 2, limit: 7, total: 0, totalPages: 0 });

    expect(subscriptionsService.list).toHaveBeenCalledWith('user-public-id', 2, 7);
  });

  it('拒絕超過 limit 上限與非法 page 或 limit', async () => {
    const authorization = 'Bearer access-token';

    for (const query of [
      '?limit=101',
      '?limit=0',
      '?limit=1.5',
      '?limit=invalid',
      '?page=0',
      '?page=-1',
      '?page=1.5',
      '?page=invalid',
    ]) {
      await request(app.getHttpServer())
        .get(`/subscriptions${query}`)
        .set('Authorization', authorization)
        .expect(400);
    }

    expect(subscriptionsService.list).not.toHaveBeenCalled();
  });

  it('允許 limit 上限 100', async () => {
    subscriptionsService.list.mockResolvedValue({
      items: [],
      page: 1,
      limit: 100,
      total: 0,
      totalPages: 0,
    });

    await request(app.getHttpServer())
      .get('/subscriptions?limit=100')
      .set('Authorization', 'Bearer access-token')
      .expect(200);

    expect(subscriptionsService.list).toHaveBeenCalledWith('user-public-id', 1, 100);
  });

  it('驗證新增訂閱的 URL DTO 並將登入者傳給 service', async () => {
    await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', 'Bearer access-token')
      .send({ url: 'not-a-url' })
      .expect(400);
    expect(subscriptionsService.create).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', 'Bearer access-token')
      .send({ url: 'https://feed.example/rss' })
      .expect(201)
      .expect({ id: 'subscription-1' });
    expect(subscriptionsService.create).toHaveBeenCalledWith(
      'user-public-id',
      'https://feed.example/rss',
    );
  });

  it('回傳暫停與恢復路由的實際結果', async () => {
    await request(app.getHttpServer())
      .patch('/subscriptions/subscription-1/pause')
      .set('Authorization', 'Bearer access-token')
      .expect(200)
      .expect({ id: 'subscription-1', status: 'PAUSED' });
    await request(app.getHttpServer())
      .patch('/subscriptions/subscription-1/resume')
      .set('Authorization', 'Bearer access-token')
      .expect(200)
      .expect({ id: 'subscription-1', status: 'ACTIVE' });
  });

  it('刪除訂閱時回傳 204', async () => {
    await request(app.getHttpServer())
      .delete('/subscriptions/subscription-1')
      .set('Authorization', 'Bearer access-token')
      .expect(204);

    expect(subscriptionsService.remove).toHaveBeenCalledWith(
      'user-public-id',
      'subscription-1',
    );
  });

  it('取消訂閱連結不需登入並顯示確認頁', async () => {
    await request(app.getHttpServer())
      .get(`/subscriptions/unsubscribe?token=${'a'.repeat(64)}`)
      .expect(200)
      .expect('Content-Type', /text\/html/)
      .expect((response) => {
        expect(response.text).toContain('Subscription cancelled');
      });

    expect(subscriptionsService.unsubscribe).toHaveBeenCalledWith('a'.repeat(64));
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('取消訂閱 token 格式錯誤時回傳 400', async () => {
    await request(app.getHttpServer())
      .get('/subscriptions/unsubscribe?token=invalid')
      .expect(400);
    expect(subscriptionsService.unsubscribe).not.toHaveBeenCalled();
  });
});