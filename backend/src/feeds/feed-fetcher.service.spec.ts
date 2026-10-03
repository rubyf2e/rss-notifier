import { BadRequestException } from '@nestjs/common';
import { FeedFetcherService } from './feed-fetcher.service';
import { FeedSsrfBlockedException } from './feed-url.validator';

describe('FeedFetcherService', () => {
  let service: FeedFetcherService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new FeedFetcherService();
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('抓取並解析 Feed 與文章資料，並正規化 URL fragment', async () => {
    fetchSpy.mockResolvedValue(new Response(
      '<rss version="2.0"><channel><title>Example Feed</title><link>https://site.example</link><description>Updates</description><item><title>First article</title><link>https://site.example/first</link><guid>first-1</guid><pubDate>Fri, 02 Oct 2026 00:00:00 GMT</pubDate><description>Summary</description></item></channel></rss>',
      { status: 200 },
    ));

    await expect(service.fetchAndParse('http://8.8.8.8/feed.xml#top')).resolves.toEqual({
      url: 'http://8.8.8.8/feed.xml',
      title: 'Example Feed',
      description: 'Updates',
      siteUrl: 'https://site.example',
      items: [{
        guid: 'first-1',
        title: 'First article',
        link: 'https://site.example/first',
        description: 'Summary',
        publishedAt: new Date('2026-10-02T00:00:00.000Z'),
      }],
    });
    expect(fetchSpy.mock.calls[0][1]).toEqual(expect.objectContaining({
      dispatcher: expect.anything(),
    }));
  });

  it('拒絕沒有 Feed 標題的普通網頁', async () => {
    fetchSpy.mockResolvedValue(new Response('<html><title>Not a feed</title></html>', {
      status: 200,
    }));

    await expect(service.fetchAndParse('http://8.8.8.8/page')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('Content-Length 超過上限時立即 abort 並拒絕 response', async () => {
    fetchSpy.mockResolvedValue(new Response('ignored', {
      status: 200,
      headers: { 'content-length': String(5 * 1024 * 1024 + 1) },
    }));

    await expect(service.fetchAndParse('http://8.8.8.8/feed.xml')).rejects.toThrow(
      'Feed response is too large.',
    );
    expect(fetchSpy.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('無 Content-Length 的超限串流會中止讀取並取消 stream', async () => {
    const cancel = jest.fn();
    let pullCount = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue(new Uint8Array(5 * 1024 * 1024));
        } else {
          controller.enqueue(new Uint8Array([1]));
        }
      },
      cancel,
    });
    fetchSpy.mockResolvedValue(new Response(body, { status: 200 }));

    await expect(service.fetchAndParse('http://8.8.8.8/feed.xml')).rejects.toThrow(
      'Feed response is too large.',
    );
    expect(fetchSpy.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(pullCount).toBeLessThan(4);
  });

  it('每次 redirect 都重新檢查目的位址，拒絕導向內網', async () => {
    fetchSpy.mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/private-feed' },
    }));

    await expect(service.fetchAndParse('http://8.8.8.8/feed.xml')).rejects.toBeInstanceOf(
      FeedSsrfBlockedException,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('多次 redirect 時逐跳驗證目的位址', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'http://1.1.1.1/next' },
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'http://[::1]/private-feed' },
      }));

    await expect(service.fetchAndParse('http://8.8.8.8/feed.xml')).rejects.toBeInstanceOf(
      FeedSsrfBlockedException,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});