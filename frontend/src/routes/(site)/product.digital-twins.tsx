import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(site)/product/digital-twins")({
  beforeLoad: () => {
    throw redirect({ to: "/sherivs" });
  },
});
