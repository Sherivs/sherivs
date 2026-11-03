import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";

const AppHomeScreen = lazy(() =>
  import("@/components/app-shell/home-screen").then((module) => ({
    default: module.AppHomeScreen,
  })),
);

function DeferredAppHomeScreen() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return <div role="status">Loading workspace…</div>;
  return (
    <Suspense fallback={<div role="status">Loading workspace…</div>}>
      <AppHomeScreen />
    </Suspense>
  );
}

export const Route = createFileRoute("/home/")({
  component: DeferredAppHomeScreen,
});
