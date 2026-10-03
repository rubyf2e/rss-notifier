import type {
  FeedResponse,
  PaginatedSubscriptionsResponse,
  SubscriptionResponse,
  SubscriptionStatus,
  UnsubscribePreview,
} from "~/types/notifier";

const DEMO_UNSUBSCRIBE_TOKEN = "demo-unsubscribe-token";
const DEMO_UNSUBSCRIBE_SUBSCRIPTION_ID = "sub-demo-verge";
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

type SubscriptionRecord = SubscriptionResponse & {
  publicId?: string;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createPublicId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function serializeSubscription(
  record: SubscriptionRecord,
): SubscriptionResponse {
  return {
    id: record.id,
    status: record.status,
    createdAt: record.createdAt,
    feed: {
      title: record.feed.title,
      url: record.feed.url,
      status: record.feed.status,
      lastSyncedAt: record.feed.lastSyncedAt,
      lastError: record.feed.lastError,
    },
  };
}

function createSeedSubscriptions(): SubscriptionRecord[] {
  const now = Date.now();
  const names = [
    "The Verge",
    "NPR News",
    "Ars Technica",
    "Hacker News",
    "Smashing Magazine",
    "Product Hunt",
    "Engadget",
    "The Verge Tech",
    "MIT Technology Review",
    "GitHub Blog",
    "TechCrunch",
    "The New Stack",
    "Reddit r/technology",
    "Mozilla Hacks",
    "VS Code Blog",
    "Docker Blog",
    "NestJS News",
    "Vue School",
    "OpenAI Blog",
    "AWS News",
    "Google Developer Blog",
    "Microsoft Dev Blog",
    "Apple Newsroom",
    "Kubernetes Blog",
    "Vercel Blog",
    "Cloudflare Blog",
    "Linus Tech Tips",
  ];

  return Array.from({ length: 27 }, (_, index) => {
    const subscriptionId =
      index === 0 ? DEMO_UNSUBSCRIBE_SUBSCRIPTION_ID : `sub-demo-${index}`;
    const feedTitle = names[index % names.length];
    const isActive = index % 4 !== 0;
    const isError = index % 5 === 0;
    const createdAt = new Date(now - index * 3 * 60 * 60_000).toISOString();
    const lastSyncedAt = new Date(now - index * 28 * 60_000).toISOString();

    return {
      id: subscriptionId,
      publicId: subscriptionId,
      status: isActive ? "ACTIVE" : "PAUSED",
      createdAt,
      feed: {
        title: feedTitle,
        url: `https://example.com/feed/${index + 1}.xml`,
        status: isError ? "ERROR" : "HEALTHY",
        lastSyncedAt,
        lastError: isError ? "連線逾時，最近一次檢查未能取得 Feed。" : null,
      },
    };
  });
}

function waitForMockResponse() {
  return new Promise<void>((resolve) => setTimeout(resolve, 280));
}

export function useNotifierApi() {
  const subscriptions = useState<SubscriptionRecord[]>(
    "mock-subscriptions",
    createSeedSubscriptions,
  );

  async function requestMagicLink(email: string) {
    await waitForMockResponse();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      throw new Error("請輸入有效的 Email 地址。");
    }

    return { message: "示範模式：登入連結申請已完成。" };
  }

  async function listSubscriptions(
    params: { page?: number; limit?: number } = {},
  ): Promise<PaginatedSubscriptionsResponse> {
    await waitForMockResponse();

    const page = Math.max(1, Number(params.page) || DEFAULT_PAGE);
    const limit = Math.max(1, Number(params.limit) || DEFAULT_LIMIT);
    const total = subscriptions.value.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;
    const sliced = subscriptions.value.slice(start, start + limit);

    return {
      items: sliced.map((item) => serializeSubscription(item)),
      page: safePage,
      limit,
      total,
      totalPages,
    };
  }

  async function createSubscription(
    url: string,
  ): Promise<SubscriptionResponse> {
    await waitForMockResponse();

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error("請輸入有效的 Feed 網址。");
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Feed 網址必須使用 HTTP 或 HTTPS。");
    }

    const normalizedUrl = parsedUrl.toString();
    if (subscriptions.value.some((item) => item.feed.url === normalizedUrl)) {
      throw new Error("這個 Feed 已經在訂閱清單中。");
    }

    const title = parsedUrl.hostname.replace(/^www\./, "").split(".")[0];
    const createdAt = new Date().toISOString();
    const subscriptionId = createPublicId("sub");
    const subscription: SubscriptionRecord = {
      id: subscriptionId,
      publicId: subscriptionId,
      status: "ACTIVE",
      createdAt,
      feed: {
        title: title.charAt(0).toUpperCase() + title.slice(1),
        url: normalizedUrl,
        status: "HEALTHY",
        lastSyncedAt: createdAt,
        lastError: null,
      },
    };

    subscriptions.value = [subscription, ...subscriptions.value];
    return serializeSubscription(subscription);
  }

  async function updateSubscriptionStatus(
    subscriptionId: string,
    status: SubscriptionStatus,
  ) {
    await waitForMockResponse();
    const subscription = subscriptions.value.find(
      (item) => item.id === subscriptionId || item.publicId === subscriptionId,
    );
    if (!subscription) {
      throw new Error("找不到這筆訂閱，請重新整理後再試。");
    }

    subscription.status = status;
    return serializeSubscription(subscription);
  }

  async function deleteSubscription(subscriptionId: string) {
    await waitForMockResponse();
    const nextSubscriptions = subscriptions.value.filter(
      (item) => item.id !== subscriptionId && item.publicId !== subscriptionId,
    );
    if (nextSubscriptions.length === subscriptions.value.length) {
      throw new Error("找不到這筆訂閱，請重新整理後再試。");
    }

    subscriptions.value = nextSubscriptions;
  }

  async function getUnsubscribePreview(
    token: string,
  ): Promise<UnsubscribePreview> {
    await waitForMockResponse();
    if (token !== DEMO_UNSUBSCRIBE_TOKEN) {
      throw new Error("取消訂閱連結無效或已失效。");
    }

    const subscription = subscriptions.value.find(
      (item) =>
        item.id === DEMO_UNSUBSCRIBE_SUBSCRIPTION_ID ||
        item.publicId === DEMO_UNSUBSCRIBE_SUBSCRIPTION_ID,
    );
    if (!subscription) {
      throw new Error("這筆訂閱已不存在或已取消。");
    }

    return { feedName: subscription.feed.title };
  }

  async function unsubscribe(token: string) {
    const preview = await getUnsubscribePreview(token);
    subscriptions.value = subscriptions.value.filter(
      (item) =>
        item.id !== DEMO_UNSUBSCRIBE_SUBSCRIPTION_ID &&
        item.publicId !== DEMO_UNSUBSCRIBE_SUBSCRIPTION_ID,
    );
    return preview;
  }

  return {
    requestMagicLink,
    listSubscriptions,
    createSubscription,
    updateSubscriptionStatus,
    deleteSubscription,
    getUnsubscribePreview,
    unsubscribe,
  };
}
