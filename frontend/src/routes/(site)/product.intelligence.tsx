import { createFileRoute } from "@tanstack/react-router";
import { ProductLayerPage } from "@/components/public/product-layer-page";
import { publicHead } from "@/lib/public-site/seo";
import { LAYER_PAGES } from "@/lib/public-site/layer-copy";

const page = LAYER_PAGES.intelligence;

export const Route = createFileRoute("/(site)/product/intelligence")({
  component: () => <ProductLayerPage pageKey="intelligence" />,
  head: () => publicHead({ title: page.title, description: page.lead, path: page.path }),
});
