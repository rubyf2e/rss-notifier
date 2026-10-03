export type SubscriptionStatus = "ACTIVE" | "PAUSED";
export type FeedHealthStatus = "HEALTHY" | "ERROR";

export interface FeedResponse {
  title: string;
  url: string;
  status: FeedHealthStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface SubscriptionResponse {
  id: string;
  status: SubscriptionStatus;
  createdAt: string;
  feed: FeedResponse;
}

export interface PaginatedSubscriptionsResponse {
  items: SubscriptionResponse[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface DemoSession {
  email: string;
}

export interface UnsubscribePreview {
  feedName: string;
}
