import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RoleGuard } from "@/components/role-guard";

export const Route = createFileRoute("/_authenticated/command-centre")({
  component: () => (
    <RoleGuard allow={["super_admin"]}>
      <Outlet />
    </RoleGuard>
  ),
});