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
import { ConsoleGate } from "@/components/internal-console/console-gate";
import { PLATFORM_PAGE_DESCRIPTION, PLATFORM_PAGE_TITLE } from "@/lib/platform";
import { publishedCompanySocial } from "@/lib/public-site/contacts";
import { Toaster } from "@/components/ui/sonner";
import { RouteProgressBar } from "@/components/route-progress-bar";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import { SherivsLockup, SherivsLogo } from "@/components/brand/sherivs-logo";
import { AnalyticsConsent } from "@/components/analytics/analytics-consent";
import { captureClientError } from "@/lib/observability/sentry-browser";

const PUBLIC_X_HANDLE = publishedCompanySocial().find((item) => item.id === "x")?.handle;

function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md text-center">
        <Link to="/" aria-label="Sherivs home" className="mb-8 inline-flex">
          <SherivsLockup height={44} />
        </Link>
        <h1 className="text-7xl font-bold bg-[image:var(--brand-gradient)] bg-clip-text text-transparent">
          404
        </h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset?: () => void }) {
  console.error(error);
  captureClientError(error);
  const message = error instanceof Error ? error.message : "An unexpected error occurred.";
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="mb-6 inline-flex">
          <SherivsLogo size={40} wordmarkClassName="text-2xl" />
        </div>
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground break-words">{message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {reset && (
            <button
              onClick={() => reset()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Try again
            </button>
          )}
          <button
            onClick={() => {
              if (typeof window !== "undefined") window.location.reload();
            }}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-accent"
          >
            Reload page
          </button>
        </div>
      </div>
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
      { name: "description", content: PLATFORM_PAGE_DESCRIPTION },
      { property: "og:description", content: PLATFORM_PAGE_DESCRIPTION },
      { name: "twitter:description", content: PLATFORM_PAGE_DESCRIPTION },
      { property: "og:image", content: "https://sherivs.com/og-image.png" },
      { name: "twitter:image", content: "https://sherivs.com/og-image.png" },
      { name: "twitter:card", content: "summary_large_image" },
      ...(PUBLIC_X_HANDLE ? [{ name: "twitter:site", content: PUBLIC_X_HANDLE }] : []),
      { property: "og:type", content: "website" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Sherivs logo" },
      { property: "og:site_name", content: "Sherivs" },
      // Served, generated manifest (see routes/manifest[.]webmanifest.ts).
      { name: "theme-color", content: "#184efd" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Sherivs" },
      { name: "mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icons/icon-192.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap",
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
        <ConsoleGate>
          <Outlet />
        </ConsoleGate>
        <Toaster richColors closeButton position="top-right" />
        <AnalyticsConsent />
      </AppProvider>
    </QueryClientProvider>
  );
}
