import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { initClientSentry } from "./lib/observability/sentry-browser";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  // Browser only; a no-op unless VITE_APP_ENV is exactly "staging" and a DSN is set.
  initClientSentry(router);

  return router;
};
