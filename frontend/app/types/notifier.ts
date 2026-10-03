export type SubscriptionStatus = "ACTIVE" | "PAUSED";
export type FeedHealthStatus = "HEALTHY" | "ERROR";

export interface FeedResponse {
  publicId: string;
  title: string;
  url: string;
  status: FeedHealthStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface SubscriptionResponse {
  publicId: string;
  status: SubscriptionStatus;
  feed: FeedResponse;
}

export interface DemoSession {
  email: string;
}

export interface UnsubscribePreview {
  feedName: string;
}
