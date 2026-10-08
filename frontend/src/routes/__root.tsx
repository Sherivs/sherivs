import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import appCss from "../styles.css?url";
import { AppProvider } from "@/contexts/app-context";
import {
  PLATFORM_NAME,
  PLATFORM_PAGE_DESCRIPTION,
  PLATFORM_PAGE_TITLE,
} from "@/lib/platform";
import { SystemState } from "@/components/sherivs/system-state";
import { Toaster } from "@/components/ui/sonner";
import { RouteProgressBar } from "@/components/route-progress-bar";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

function NotFoundComponent() {
  return (
    <div data-sx="" className="grid min-h-dvh place-items-center px-6">
      <main id="main-content" tabIndex={-1} className="w-full max-w-xl outline-none">
        <SystemState
          kind="not-found"
          headingLevel="h1"
          title="This page does not exist"
          description="The address may be mistyped, or the page may have moved. Nothing was changed."
          actions={
            <Link to="/" className="sx-button sx-button-primary">
              Go to {PLATFORM_NAME}
            </Link>
          }
        />
      </main>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset?: () => void }) {
  console.error(error);
  return (
    <div data-sx="" className="grid min-h-dvh place-items-center px-6">
      <main id="main-content" tabIndex={-1} className="w-full max-w-xl outline-none">
        <SystemState
          kind="error"
          headingLevel="h1"
          title="Something went wrong"
          description="This page could not be displayed. Your data was not changed by this error. Try again, or reload the page."
          actions={
            <>
              {reset && (
                <button type="button" onClick={() => reset()} className="sx-button sx-button-primary">
                  Try again
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined") window.location.reload();
                }}
                className="sx-button sx-button-secondary"
              >
                Reload page
              </button>
            </>
          }
        />
      </main>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: PLATFORM_PAGE_TITLE },
      { name: "description", content: PLATFORM_PAGE_DESCRIPTION },
      { property: "og:title", content: PLATFORM_PAGE_TITLE },
      { name: "twitter:title", content: PLATFORM_PAGE_TITLE },
      { property: "og:site_name", content: PLATFORM_NAME },
      { property: "og:description", content: PLATFORM_PAGE_DESCRIPTION },
      { name: "twitter:description", content: PLATFORM_PAGE_DESCRIPTION },
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
      // Served, generated manifest (see routes/manifest[.]webmanifest.ts).
      { name: "theme-color", media: "(prefers-color-scheme: light)", content: "#fafaf8" },
      { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#07090c" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: PLATFORM_NAME },
      { name: "mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icons/icon-192.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Inter+Tight:wght@500;600&family=JetBrains+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="light">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-white focus:text-black focus:rounded-lg focus:font-semibold"
        >
          Skip to main content
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <RouteProgressBar />
        <Outlet />
        <Toaster richColors closeButton position="top-right" />
      </AppProvider>
    </QueryClientProvider>
  );
}
