import { createHash } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import Parser from 'rss-parser';
import { assertPublicFeedUrl } from './feed-url.validator';

const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export interface ParsedFeedArticle {
  guid: string;
  title: string;
  link: string;
  description: string | null;
  publishedAt: Date | null;
}

export interface ParsedFeed {
  url: string;
  title: string;
  description: string | null;
  siteUrl: string | null;
  items: ParsedFeedArticle[];
}

@Injectable()
export class FeedFetcherService {
  private readonly parser = new Parser();

  async fetchAndParse(inputUrl: string): Promise<ParsedFeed> {
    let url: URL;
    try {
      url = new URL(inputUrl);
    } catch {
      throw new BadRequestException('Feed URL is invalid.');
    }
    url.hash = '';

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      await assertPublicFeedUrl(url);

      let response: Response;
      try {
        response = await fetch(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
          headers: {
            accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml, */*',
            'user-agent': 'rss-notifier/1.0',
          },
        });
      } catch {
        throw new BadRequestException('Feed URL could not be reached.');
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirectCount === MAX_REDIRECTS) {
          throw new BadRequestException('Feed URL has an invalid or excessive redirect chain.');
        }
        try {
          url = new URL(location, url);
          url.hash = '';
        } catch {
          throw new BadRequestException('Feed URL has an invalid redirect destination.');
        }
        continue;
      }

      if (!response.ok) {
        throw new BadRequestException(`Feed URL returned HTTP ${response.status}.`);
      }

      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > MAX_FEED_BYTES) {
        throw new BadRequestException('Feed response is too large.');
      }

      let body: string;
      try {
        body = await response.text();
      } catch {
        throw new BadRequestException('Feed response could not be read.');
      }
      if (Buffer.byteLength(body) > MAX_FEED_BYTES) {
        throw new BadRequestException('Feed response is too large.');
      }

      let parsedFeed: Awaited<ReturnType<Parser['parseString']>>;
      try {
        parsedFeed = await this.parser.parseString(body);
      } catch {
        throw new BadRequestException('URL does not contain a valid RSS or Atom feed.');
      }

      const title = parsedFeed.title?.trim();
      if (!title) {
        throw new BadRequestException('URL does not contain a valid RSS or Atom feed.');
      }

      return {
        url: url.toString(),
        title,
        description: parsedFeed.description ?? null,
        siteUrl: parsedFeed.link ?? null,
        items: (parsedFeed.items ?? []).flatMap((item) => {
          const itemTitle = item.title?.trim();
          const link = item.link?.trim();
          if (!itemTitle || !link) {
            return [];
          }

          const dateValue = item.isoDate ?? item.pubDate;
          const parsedDate = dateValue ? new Date(dateValue) : null;
          const publishedAt = parsedDate && !Number.isNaN(parsedDate.getTime())
            ? parsedDate
            : null;
          const guid = item.guid?.trim() || link || createHash('sha256')
            .update(`${itemTitle}\n${dateValue ?? ''}`)
            .digest('hex');

          return [{
            guid,
            title: itemTitle,
            link,
            description: item.contentSnippet ?? item.content ?? null,
            publishedAt,
          }];
        }),
      };
    }

    throw new BadRequestException('Feed URL has an invalid or excessive redirect chain.');
  }
}