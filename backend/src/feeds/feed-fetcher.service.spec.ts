import { BadRequestException } from '@nestjs/common';
import { FeedFetcherService } from './feed-fetcher.service';

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
  });

  it('拒絕沒有 Feed 標題的普通網頁', async () => {
    fetchSpy.mockResolvedValue(new Response('<html><title>Not a feed</title></html>', {
      status: 200,
    }));

    await expect(service.fetchAndParse('http://8.8.8.8/page')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('每次 redirect 都重新檢查目的位址，拒絕導向內網', async () => {
    fetchSpy.mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/private-feed' },
    }));

    await expect(service.fetchAndParse('http://8.8.8.8/feed.xml')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});