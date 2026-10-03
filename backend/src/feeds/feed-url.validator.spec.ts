import { BadRequestException } from '@nestjs/common';
import { assertPublicFeedUrl } from './feed-url.validator';

describe('Feed URL 網路位址驗證', () => {
  it.each([
    'http://127.0.0.1/feed.xml',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/feed.xml',
    'http://[fd00::1]/feed.xml',
    'http://localhost/feed.xml',
  ])('拒絕本機或內部網址：%s', async (input) => {
    await expect(assertPublicFeedUrl(new URL(input))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('拒絕解析到私有 IP 的 hostname', async () => {
    const resolver = jest.fn().mockResolvedValue([
      { address: '10.1.2.3', family: 4 },
    ]);

    await expect(
      assertPublicFeedUrl(new URL('https://feed.example/rss'), resolver),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('其中一筆 DNS 結果為私有 IP 時拒絕整個 hostname', async () => {
    const resolver = jest.fn().mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '192.168.1.2', family: 4 },
    ]);

    await expect(
      assertPublicFeedUrl(new URL('https://mixed.example/rss'), resolver),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('允許解析到公開 IP 的 hostname', async () => {
    const resolver = jest.fn().mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
    ]);

    await expect(
      assertPublicFeedUrl(new URL('https://feed.example/rss'), resolver),
    ).resolves.toBeUndefined();
  });
});