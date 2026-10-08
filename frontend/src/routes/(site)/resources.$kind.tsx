import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { PUBLIC_CONTENT_KINDS, type PublicContentKind } from "@/lib/experience-system/content";

export function asContentKind(value: string): PublicContentKind | undefined {
  return PUBLIC_CONTENT_KINDS.find((k) => k === value);
}

export const Route = createFileRoute("/(site)/resources/$kind")({
  loader: ({ params }) => {
    if (!asContentKind(params.kind)) throw notFound();
  },
  component: Outlet,
});
