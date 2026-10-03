import type {
  FeedResponse,
  SubscriptionResponse,
  SubscriptionStatus,
  UnsubscribePreview,
} from "~/types/notifier";

const DEMO_UNSUBSCRIBE_TOKEN = "demo-unsubscribe-token";
const DEMO_UNSUBSCRIBE_SUBSCRIPTION_ID = "sub-demo-verge";

function createSeedSubscriptions(): SubscriptionResponse[] {
  const now = Date.now();

  return [
    {
      publicId: DEMO_UNSUBSCRIBE_SUBSCRIPTION_ID,
      status: "ACTIVE",
      feed: {
        publicId: "feed-demo-verge",
        title: "The Verge",
        url: "https://www.theverge.com/rss/index.xml",
        status: "HEALTHY",
        lastSyncedAt: new Date(now - 12 * 60_000).toISOString(),
        lastError: null,
        lastErrorAt: null,
      },
    },
    {
      publicId: "sub-demo-npr",
      status: "PAUSED",
      feed: {
        publicId: "feed-demo-npr",
        title: "NPR News",
        url: "https://feeds.npr.org/1001/rss.xml",
        status: "HEALTHY",
        lastSyncedAt: new Date(now - 48 * 60_000).toISOString(),
        lastError: null,
        lastErrorAt: null,
      },
    },
    {
      publicId: "sub-demo-ars",
      status: "ACTIVE",
      feed: {
        publicId: "feed-demo-ars",
        title: "Ars Technica",
        url: "https://feeds.arstechnica.com/arstechnica/index",
        status: "ERROR",
        lastSyncedAt: new Date(now - 4 * 60 * 60_000).toISOString(),
        lastError: "連線逾時，最近一次檢查未能取得 Feed。",
        lastErrorAt: new Date(now - 38 * 60_000).toISOString(),
      },
    },
  ];
}

function waitForMockResponse() {
  return new Promise<void>((resolve) => setTimeout(resolve, 380));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createPublicId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useNotifierApi() {
  const subscriptions = useState<SubscriptionResponse[]>(
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

  async function listSubscriptions() {
    await waitForMockResponse();
    return clone(subscriptions.value);
  }

  async function createSubscription(url: string) {
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
    const feed: FeedResponse = {
      publicId: createPublicId("feed"),
      title: title.charAt(0).toUpperCase() + title.slice(1),
      url: normalizedUrl,
      status: "HEALTHY",
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
      lastErrorAt: null,
    };
    const subscription: SubscriptionResponse = {
      publicId: createPublicId("sub"),
      status: "ACTIVE",
      feed,
    };

    subscriptions.value = [subscription, ...subscriptions.value];
    return clone(subscription);
  }

  async function updateSubscriptionStatus(
    publicId: string,
    status: SubscriptionStatus,
  ) {
    await waitForMockResponse();
    const subscription = subscriptions.value.find(
      (item) => item.publicId === publicId,
    );
    if (!subscription) {
      throw new Error("找不到這筆訂閱，請重新整理後再試。");
    }

    subscription.status = status;
    return clone(subscription);
  }

  async function deleteSubscription(publicId: string) {
    await waitForMockResponse();
    const nextSubscriptions = subscriptions.value.filter(
      (item) => item.publicId !== publicId,
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
      (item) => item.publicId === DEMO_UNSUBSCRIBE_SUBSCRIPTION_ID,
    );
    if (!subscription) {
      throw new Error("這筆訂閱已不存在或已取消。");
    }

    return { feedName: subscription.feed.title };
  }

  async function unsubscribe(token: string) {
    const preview = await getUnsubscribePreview(token);
    subscriptions.value = subscriptions.value.filter(
      (item) => item.publicId !== DEMO_UNSUBSCRIBE_SUBSCRIPTION_ID,
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
