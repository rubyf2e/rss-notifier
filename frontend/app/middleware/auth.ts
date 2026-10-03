const validationRequests = new WeakMap<object, Promise<boolean>>();

function getErrorStatus(error: unknown) {
  if (typeof error !== "object" || error === null) return undefined;
  const apiError = error as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
  };
  return apiError.statusCode ?? apiError.status ?? apiError.response?.status;
}

export default defineNuxtRouteMiddleware(async () => {
  const auth = useNotifierAuth();
  if (!auth.session.value?.accessToken) {
    auth.clearSession();
    return navigateTo("/login", { replace: true });
  }
  if (auth.validation.value === "valid") return;

  const nuxtApp = useNuxtApp();
  let validationRequest = validationRequests.get(nuxtApp);
  if (!validationRequest) {
    auth.validation.value = "validating";
    validationRequest = (async () => {
      try {
        const response = await useNotifierApi().listSubscriptions({
          page: 1,
          limit: 10,
        });
        auth.markSessionValid(response);
        return true;
      } catch (error) {
        const status = getErrorStatus(error);
        if (status === 401 || status === 403) {
          auth.clearSession();
          return false;
        }
        auth.validation.value = "unvalidated";
        throw error;
      }
    })();
    validationRequests.set(nuxtApp, validationRequest);
  }

  try {
    if (!(await validationRequest)) {
      return navigateTo("/login", { replace: true });
    }
  } finally {
    validationRequests.delete(nuxtApp);
  }
});
