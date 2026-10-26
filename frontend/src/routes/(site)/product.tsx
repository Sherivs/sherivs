import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Layout for `/product/*`.
 *
 * `/product` itself is the index child (redirects to `/sherivs`). Nested
 * layer pages must render here — this parent must never redirect, or
 * `/product/architecture` and siblings collapse into the platform overview.
 * Public `/product` is the collision-safe stand-in for internal `/platform`.
 */
export const Route = createFileRoute("/(site)/product")({
  component: ProductLayout,
});

function ProductLayout() {
  return <Outlet />;
}
