import { createHash, createHmac } from 'node:crypto';

export function createUnsubscribeToken(subscriptionPublicId: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`unsubscribe:${subscriptionPublicId}`)
    .digest('hex');
}

export function hashUnsubscribeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}