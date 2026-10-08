import { createFileRoute } from "@tanstack/react-router";
import { CommandCentre } from "@/components/command-centre/command-centre";

export const Route = createFileRoute("/_authenticated/command-centre/provision")({
  ssr: false,
  component: CommandCentre,
  head: () => ({
    meta: [
      { title: "Sherivs — organization provisioning" },
      {
        name: "description",
        content:
          "Authorized operator provisioning for an organization. This surface is not part of the public website.",
      },
    ],
  }),
});
