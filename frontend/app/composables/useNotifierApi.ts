import type {
  MagicLinkSessionResponse,
  PaginatedSubscriptionsResponse,
  SubscriptionResponse,
} from "~/types/notifier";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: Record<string, string>;
  query?: Record<string, string | number>;
};

function getErrorStatus(error: unknown) {
  if (typeof error !== "object" || error === null) return undefined;
  const fetchError = error as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
  };
  return (
    fetchError.statusCode ?? fetchError.status ?? fetchError.response?.status
  );
}

export function useNotifierApi() {
  const config = useRuntimeConfig();
  const router = useRouter();
  const auth = useNotifierAuth();
  const configuredBase = String(config.public.apiBase).replace(/\/+$/, "");
  const serverBase = import.meta.server
    ? new URL(configuredBase || "http://backend:3000")
    : null;
  if (
    serverBase &&
    (serverBase.hostname === "localhost" || serverBase.hostname === "127.0.0.1")
  ) {
    serverBase.hostname = "backend";
  }
  const serverPath = serverBase?.pathname.replace(/\/+$/, "") ?? "";
  const baseURL = import.meta.server
    ? `${serverBase?.origin}${serverPath.endsWith("/api") ? serverPath : `${serverPath}/api`}`
    : "/api/backend";

  async function request<T>(
    path: string,
    options: RequestOptions = {},
    requiresAuth = false,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (requiresAuth && auth.session.value?.accessToken) {
      headers.Authorization = `Bearer ${auth.session.value.accessToken}`;
    }

    try {
      return await $fetch<T>(path, { baseURL, ...options, headers });
    } catch (error) {
      const status = getErrorStatus(error);
      if (requiresAuth && (status === 401 || status === 403)) {
        const wasValidated = auth.validation.value === "valid";
        auth.clearSession();
        if (wasValidated && router.currentRoute.value.path !== "/login") {
          await navigateTo("/login", { replace: true });
        }
      }
      throw error;
    }
  }

  function getErrorMessage(error: unknown, fallback: string): string {
    if (typeof error === "object" && error !== null && "data" in error) {
      const data = error.data;
      if (typeof data === "object" && data !== null && "message" in data) {
        const message = data.message;
        if (typeof message === "string") return message;
        if (
          Array.isArray(message) &&
          message.every((item) => typeof item === "string")
        ) {
          return message.join("\n");
        }
      }
    }
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  }

  function requestMagicLink(email: string) {
    return request<{ message: string }>("/auth/magic-link", {
      method: "POST",
      body: { email },
    });
  }

  function verifyMagicLink(token: string) {
    return request<MagicLinkSessionResponse>("/auth/magic-link/verify", {
      query: { token },
    });
  }

  function listSubscriptions(params: { page?: number; limit?: number } = {}) {
    return request<PaginatedSubscriptionsResponse>(
      "/subscriptions",
      { query: { page: params.page ?? 1, limit: params.limit ?? 10 } },
      true,
    );
  }

  function createSubscription(url: string) {
    return request<SubscriptionResponse>(
      "/subscriptions",
      { method: "POST", body: { url } },
      true,
    );
  }

  function updateSubscriptionStatus(
    subscriptionId: string,
    status: "ACTIVE" | "PAUSED",
  ) {
    const action = status === "PAUSED" ? "pause" : "resume";
    return request<SubscriptionResponse>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}/${action}`,
      { method: "PATCH" },
      true,
    );
  }

  function deleteSubscription(subscriptionId: string) {
    return request<void>(
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { method: "DELETE" },
      true,
    );
  }

  function unsubscribe(token: string) {
    return request<string>("/subscriptions/unsubscribe", {
      query: { token },
    });
  }

  return {
    requestMagicLink,
    verifyMagicLink,
    listSubscriptions,
    createSubscription,
    updateSubscriptionStatus,
    deleteSubscription,
    unsubscribe,
    getErrorMessage,
  };
}
