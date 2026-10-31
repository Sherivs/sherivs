import { createFileRoute, redirect } from "@tanstack/react-router";

/** `/product` is an alias of the public platform overview. Nested `/product/*` pages are siblings, not this redirect. */
export const Route = createFileRoute("/(site)/product/")({
  beforeLoad: () => {
    throw redirect({ to: "/sherivs" });
  },
});
