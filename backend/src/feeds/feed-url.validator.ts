import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { BadRequestException } from '@nestjs/common';
import ipaddr from 'ipaddr.js';

type ResolvedAddress = { address: string; family: number };
type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

const resolveHost: HostResolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

export class FeedSsrfBlockedException extends BadRequestException {
  constructor() {
    super('Feed URL is blocked by SSRF protection.');
  }
}

function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}

export async function assertPublicFeedUrl(
  url: URL,
  resolver: HostResolver = resolveHost,
): Promise<ResolvedAddress[]> {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new FeedSsrfBlockedException();
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new FeedSsrfBlockedException();
  }

  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw new FeedSsrfBlockedException();
    }
    return [{ address: hostname, family: isIP(hostname) }];
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new FeedSsrfBlockedException();
  }

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new FeedSsrfBlockedException();
  }

  return addresses;
}

export function createPinnedFeedLookup(
  hostname: string,
  addresses: ResolvedAddress[],
): (
  hostname: string,
  options: { all?: boolean; family?: number | 'IPv4' | 'IPv6' },
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | ResolvedAddress[],
    family?: number,
  ) => void,
) => void {
  const expectedHostname = hostname.toLowerCase();
  const lookupPinnedAddress = (
    requestedHostname: string,
    options: { all?: boolean; family?: number | 'IPv4' | 'IPv6' },
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | ResolvedAddress[],
      family?: number,
    ) => void,
  ) => {
    const matchingAddresses = requestedHostname.toLowerCase() === expectedHostname
      ? addresses.filter(({ family }) =>
        !options.family ||
        family === options.family ||
        (options.family === 'IPv4' && family === 4) ||
        (options.family === 'IPv6' && family === 6),
      )
      : [];
    if (matchingAddresses.length === 0) {
      const error = Object.assign(new Error('Feed address validation failed.'), {
        code: 'EACCES',
      });
      callback(error, options.all ? [] : '', 0);
      return;
    }

    if (options.all) {
      callback(null, matchingAddresses);
      return;
    }
    callback(null, matchingAddresses[0].address, matchingAddresses[0].family);
  };

  return lookupPinnedAddress;
}