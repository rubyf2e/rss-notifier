import type { DemoSession } from "~/types/notifier";

export default defineNuxtRouteMiddleware(() => {
  const session = useCookie<DemoSession | null>("rss-notifier-demo-session");
  if (!session.value) {
    return navigateTo("/login");
  }
});
