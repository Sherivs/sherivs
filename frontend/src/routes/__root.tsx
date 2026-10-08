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
import { PLATFORM_PAGE_DESCRIPTION, PLATFORM_PAGE_TITLE } from "@/lib/platform";
import { BRAND, canonicalUrl } from "@/lib/experience/brand";
import { StateBlock } from "@/components/sherivs/primitives";
import { Toaster } from "@/components/ui/sonner";
import { RouteProgressBar } from "@/components/route-progress-bar";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

function NotFoundComponent() {
  return (
    <div className="grid min-h-dvh place-items-center bg-plane-0 px-4 text-ink-1">
      <div className="w-full max-w-md">
        <StateBlock
          kind="not-found"
          title="Page not found"
          description="The address does not match any surface on this platform."
          action={
            <Link
              to="/"
              className="sh-interactive sh-focus sh-small inline-flex h-10 items-center rounded-[var(--sh-radius-md)] bg-signal px-4 font-semibold text-signal-on hover:bg-signal-strong"
            >
              Go home
            </Link>
          }
        />
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset?: () => void }) {
  console.error(error);
  return (
    <div className="grid min-h-dvh place-items-center bg-plane-0 px-4 text-ink-1">
      <div className="w-full max-w-md">
        <StateBlock
          kind="error"
          title="Something went wrong"
          description={error?.message ?? "An unexpected error occurred."}
          action={
            <>
              {reset && (
                <button
                  type="button"
                  onClick={() => reset()}
                  className="sh-interactive sh-focus sh-small inline-flex h-10 items-center rounded-[var(--sh-radius-md)] bg-signal px-4 font-semibold text-signal-on hover:bg-signal-strong"
                >
                  Try again
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined") window.location.reload();
                }}
                className="sh-interactive sh-focus sh-small inline-flex h-10 items-center rounded-[var(--sh-radius-md)] border border-line-2 bg-plane-2 px-4 font-semibold text-ink-1"
              >
                Reload page
              </button>
            </>
          }
        />
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
      { property: "og:site_name", content: BRAND.name },
      { property: "og:image", content: canonicalUrl("/icons/icon-512.png") },
      { name: "twitter:image", content: canonicalUrl("/icons/icon-512.png") },
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
      // Served, generated manifest (see routes/manifest[.]webmanifest.ts).
      // Theme colour mirrors --sh-plane-0 (dark) / --sh-plane-0 (light) in sherivs-tokens.css.
      { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#0b0d12" },
      { name: "theme-color", media: "(prefers-color-scheme: light)", content: "#f9fafb" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: BRAND.name },
      { name: "mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icons/icon-192.png" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&family=JetBrains+Mono:wght@400;500&display=swap",
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
        <a href="#main-content" className="sh-skip-link">
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
