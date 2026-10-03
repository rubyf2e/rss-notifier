import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { BadRequestException } from '@nestjs/common';
import ipaddr from 'ipaddr.js';

type ResolvedAddress = { address: string; family: number };
type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

const resolveHost: HostResolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

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
): Promise<void> {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new BadRequestException('Feed URL must be an HTTP or HTTPS URL without credentials.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new BadRequestException('Feed URL cannot target a local or internal host.');
  }

  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw new BadRequestException('Feed URL cannot target a local or internal address.');
    }
    return;
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new BadRequestException('Feed URL host could not be resolved.');
  }

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new BadRequestException('Feed URL cannot resolve to a local or internal address.');
  }
}