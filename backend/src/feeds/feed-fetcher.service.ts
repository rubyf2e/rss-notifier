import { createHash } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import Parser from 'rss-parser';
import { Agent } from 'undici';
import { assertPublicFeedUrl, createPinnedFeedLookup } from './feed-url.validator';

const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export class FeedResponseTooLargeException extends BadRequestException {
  constructor() {
    super('Feed response is too large.');
  }
}

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
      const addresses = await assertPublicFeedUrl(url);
      const dispatcher = new Agent({
        connect: {
          lookup: createPinnedFeedLookup(url.hostname.replace(/^\[|\]$/g, ''), addresses),
        },
      });

      const requestController = new AbortController();
      let response: Response;
      try {
        response = await fetch(url, {
          redirect: 'manual',
          dispatcher,
          signal: AbortSignal.any([
            AbortSignal.timeout(10_000),
            requestController.signal,
          ]),
          headers: {
            accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml, */*',
            'user-agent': 'rss-notifier/1.0',
          },
        } as RequestInit & { dispatcher: Agent });
      } catch {
        await dispatcher.destroy().catch(() => undefined);
        throw new BadRequestException('Feed URL could not be reached.');
      }

      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        await dispatcher.destroy().catch(() => undefined);
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
        await response.body?.cancel().catch(() => undefined);
        await dispatcher.destroy().catch(() => undefined);
        throw new BadRequestException(`Feed URL returned HTTP ${response.status}.`);
      }

      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > MAX_FEED_BYTES) {
        requestController.abort();
        await response.body?.cancel().catch(() => undefined);
        await dispatcher.destroy().catch(() => undefined);
        throw new FeedResponseTooLargeException();
      }

      let body: string;
      try {
        body = await this.readResponseBody(response, requestController);
        await dispatcher.close();
      } catch (error) {
        await dispatcher.destroy().catch(() => undefined);
        if (error instanceof FeedResponseTooLargeException) {
          throw error;
        }
        throw new BadRequestException('Feed response could not be read.');
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

  private async readResponseBody(
    response: Response,
    requestController: AbortController,
  ): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      return '';
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        totalBytes += value.byteLength;
        if (totalBytes > MAX_FEED_BYTES) {
          requestController.abort();
          await reader.cancel().catch(() => undefined);
          throw new FeedResponseTooLargeException();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
  }
}