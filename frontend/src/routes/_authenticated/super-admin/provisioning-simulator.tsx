import { createFileRoute } from "@tanstack/react-router";
import { CommandCentre } from "@/components/command-centre/command-centre";

/**
 * Sherivs provisioning simulator — an in-memory walkthrough of organization, role and
 * policy provisioning against the real onboarding and security-policy engines. Nothing
 * is persisted. Internal to the control plane: super-admin boundary only, never a
 * customer or public surface.
 */
export const Route = createFileRoute("/_authenticated/super-admin/provisioning-simulator")({
  ssr: false,
  component: CommandCentre,
  head: () => ({
    meta: [{ title: "Provisioning simulator — Sherivs" }, { name: "robots", content: "noindex" }],
  }),
});
