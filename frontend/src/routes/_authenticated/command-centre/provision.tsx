import { createFileRoute } from "@tanstack/react-router";
import { CommandCentre } from "@/components/command-centre/command-centre";

/**
 * Organization provisioning workspace.
 *
 * Previously rendered at the public root for any visitor. It now lives behind
 * the super_admin gate of the command-centre layout: an operator surface must
 * never be reachable from the public entry point.
 */
export const Route = createFileRoute("/_authenticated/command-centre/provision")({
  ssr: false,
  component: CommandCentre,
  head: () => ({ meta: [{ title: "Provision an organization — Sherivs" }] }),
});
