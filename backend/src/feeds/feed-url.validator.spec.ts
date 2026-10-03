import {
  assertPublicFeedUrl,
  createPinnedFeedLookup,
  FeedSsrfBlockedException,
} from './feed-url.validator';

describe('Feed URL 網路位址驗證', () => {
  it.each([
    'http://127.0.0.1/feed.xml',
    'http://10.0.0.1/feed.xml',
    'http://192.168.1.1/feed.xml',
    'http://169.254.169.254/latest/meta-data',
    'http://0.0.0.0/feed.xml',
    'http://224.0.0.1/feed.xml',
    'http://192.0.2.1/feed.xml',
    'http://[::1]/feed.xml',
    'http://[fe80::1]/feed.xml',
    'http://[fd00::1]/feed.xml',
    'http://[::ffff:127.0.0.1]/feed.xml',
    'http://localhost/feed.xml',
    'http://127.1/feed.xml',
    'http://2130706433/feed.xml',
    'http://0x7f000001/feed.xml',
  ])('拒絕本機或內部網址：%s', async (input) => {
    await expect(assertPublicFeedUrl(new URL(input))).rejects.toBeInstanceOf(
      FeedSsrfBlockedException,
    );
  });

  it('拒絕解析到私有 IP 的 hostname', async () => {
    const resolver = jest.fn().mockResolvedValue([
      { address: '10.1.2.3', family: 4 },
    ]);

    await expect(
      assertPublicFeedUrl(new URL('https://feed.example/rss'), resolver),
    ).rejects.toBeInstanceOf(FeedSsrfBlockedException);
  });

  it('其中一筆 DNS 結果為私有 IP 時拒絕整個 hostname', async () => {
    const resolver = jest.fn().mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '192.168.1.2', family: 4 },
    ]);

    await expect(
      assertPublicFeedUrl(new URL('https://mixed.example/rss'), resolver),
    ).rejects.toBeInstanceOf(FeedSsrfBlockedException);
  });

  it('允許解析到公開 IP 的 hostname 並回傳驗證位址', async () => {
    const resolver = jest.fn().mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
    ]);

    await expect(
      assertPublicFeedUrl(new URL('https://feed.example/rss'), resolver),
    ).resolves.toEqual([{ address: '8.8.8.8', family: 4 }]);
    expect(resolver).toHaveBeenCalledWith('feed.example');
  });

  it('socket lookup 只回傳預先驗證的位址，不會再次解析 hostname', () => {
    const lookup = createPinnedFeedLookup('feed.example', [
      { address: '8.8.8.8', family: 4 },
      { address: '2001:4860:4860::8888', family: 6 },
    ]);
    const callback = jest.fn();

    lookup('feed.example', { all: true, family: 0 }, callback);

    expect(callback).toHaveBeenCalledWith(null, [
      { address: '8.8.8.8', family: 4 },
      { address: '2001:4860:4860::8888', family: 6 },
    ]);
  });

  it('socket lookup 不接受另一個 hostname', () => {
    const lookup = createPinnedFeedLookup('feed.example', [
      { address: '8.8.8.8', family: 4 },
    ]);
    const callback = jest.fn();

    lookup('private.example', { all: false, family: 0 }, callback);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'EACCES' }),
      '',
      0,
    );
  });
});