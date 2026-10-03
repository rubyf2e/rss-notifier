import type { DemoSession } from "~/types/notifier";

const SESSION_COOKIE = "rss-notifier-demo-session";

export function useDemoAuth() {
  const session = useCookie<DemoSession | null>(SESSION_COOKIE, {
    maxAge: 60 * 60 * 24 * 7,
    sameSite: "lax",
  });

  function startDemoSession(email: string) {
    session.value = { email };
  }

  function endDemoSession() {
    session.value = null;
  }

  return { session, startDemoSession, endDemoSession };
}
