export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  const configuredBase = String(config.public.apiBase).replace(/\/+$/, "");
  const baseURL = new URL(configuredBase || "http://backend:3000");
  const requestURL = getRequestURL(event);

  if (baseURL.hostname === "localhost" || baseURL.hostname === "127.0.0.1") {
    baseURL.hostname = "backend";
  }

  const basePath = baseURL.pathname.replace(/\/+$/, "");
  const apiPrefix = basePath.endsWith("/api") ? "" : "/api";
  const apiPath = requestURL.pathname.replace(/^\/api\/backend/, "");
  baseURL.pathname = `${basePath}${apiPrefix}${apiPath}`;
  baseURL.search = requestURL.search;

  return proxyRequest(event, baseURL.toString());
});
