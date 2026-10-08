import { createFileRoute } from "@tanstack/react-router";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";
import { SherivsHome } from "@/components/sherivs/sherivs-home";
import {
  SHERIVS_PAGE_DESCRIPTION,
  SHERIVS_PAGE_TITLE,
  SHERIVS_PUBLIC_ORIGIN,
} from "@/lib/sherivs-brand";

/** Canonical Sherivs overview — the same narrative served at / for visitors. */
export const Route = createFileRoute("/sherivs")({
  component: SherivsPage,
  head: () => ({
    meta: [
      { title: SHERIVS_PAGE_TITLE },
      { name: "description", content: SHERIVS_PAGE_DESCRIPTION },
      { property: "og:title", content: SHERIVS_PAGE_TITLE },
      { property: "og:description", content: SHERIVS_PAGE_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SHERIVS_PUBLIC_ORIGIN}/sherivs` },
    ],
    links: [{ rel: "canonical", href: `${SHERIVS_PUBLIC_ORIGIN}/sherivs` }],
  }),
});

function SherivsPage() {
  return (
    <SherivsPublicShell>
      <SherivsHome />
    </SherivsPublicShell>
  );
}
