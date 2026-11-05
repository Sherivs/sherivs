import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";

const AppShellLayout = lazy(() =>
  import("@/components/app-shell/app-shell").then((module) => ({
    default: module.AppShellLayout,
  })),
);

function DeferredAppShellLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return <div role="status">Loading workspace…</div>;
  return (
    <Suspense fallback={<div role="status">Loading workspace…</div>}>
      <AppShellLayout />
    </Suspense>
  );
}

export const Route = createFileRoute("/home")({
  component: DeferredAppShellLayout,
  head: () => ({ meta: [{ title: "Home — Sherivs" }] }),
});
