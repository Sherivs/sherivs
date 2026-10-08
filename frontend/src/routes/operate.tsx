import { createFileRoute } from "@tanstack/react-router";
import { CommandCentre } from "@/components/command-centre/command-centre";
import { PLATFORM_KERNEL_NAME, PLATFORM_NAME } from "@/lib/platform";

/**
 * Operator console. Moved off the public homepage so sherivs.com can introduce
 * the product. This surface still provisions organizations; it is not linked
 * from customer navigation.
 */
export const Route = createFileRoute("/operate")({
  component: OperateRoute,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} operator console` },
      {
        name: "description",
        content: `Provision organizations on the ${PLATFORM_KERNEL_NAME} kernel. This is an operator surface, not the public site.`,
      },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function OperateRoute() {
  return <CommandCentre />;
}
