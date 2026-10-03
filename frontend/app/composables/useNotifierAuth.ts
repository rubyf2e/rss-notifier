import type { PaginatedSubscriptionsResponse } from "~/types/notifier";

export interface AuthSession {
  accessToken: string;
  user: {
    id: string;
    email: string;
  };
}

export function useNotifierAuth() {
  const session = useCookie<AuthSession | null>("rss-notifier-session", {
    maxAge: 60 * 60 * 24 * 7,
    sameSite: "lax",
  });
  const validation = useState<"unvalidated" | "validating" | "valid" | "anonymous">(
    "notifier-auth-validation",
    () => "unvalidated",
  );
  const validatedSubscriptions = useState<PaginatedSubscriptionsResponse | null>(
    "notifier-auth-subscriptions",
    () => null,
  );

  function setSession(value: AuthSession) {
    session.value = value;
    validation.value = "unvalidated";
    validatedSubscriptions.value = null;
  }

  function markSessionValid(response: PaginatedSubscriptionsResponse) {
    validation.value = "valid";
    validatedSubscriptions.value = response;
  }

  function clearSession() {
    session.value = null;
    validation.value = "anonymous";
    validatedSubscriptions.value = null;
  }

  function consumeValidatedSubscriptions() {
    const response = validatedSubscriptions.value;
    validatedSubscriptions.value = null;
    return response;
  }

  return {
    session,
    validation,
    setSession,
    markSessionValid,
    clearSession,
    consumeValidatedSubscriptions,
  };
}