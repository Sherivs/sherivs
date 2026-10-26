import { createFileRoute, redirect } from "@tanstack/react-router";
import { currentEffectiveHostKind } from "@/lib/experience/console-host-routing";

// Spec calls the single sign-in URL `/login`. On the app host the splash
// Sign In panel is canonical; elsewhere `/auth` remains.
export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && currentEffectiveHostKind() === "app") {
      throw redirect({ to: "/", search: { panel: "signin" } });
    }
    throw redirect({ to: "/auth" });
  },
});
