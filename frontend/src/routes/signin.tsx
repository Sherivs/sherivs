import { createFileRoute, redirect } from "@tanstack/react-router";

/** Canonical sign-in alias. The identity gateway surface lives at `/auth`. */
export const Route = createFileRoute("/signin")({
  beforeLoad: () => {
    throw redirect({ to: "/auth" });
  },
});
