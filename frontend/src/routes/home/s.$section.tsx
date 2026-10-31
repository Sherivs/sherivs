import { createFileRoute } from "@tanstack/react-router";
import { AppSectionScreen } from "@/components/app-shell/section-screen";
import { parseAppShellSectionKey } from "@/lib/shell/paths";

export const Route = createFileRoute("/home/s/$section")({
  component: SectionPage,
});

function SectionPage() {
  const { section } = Route.useParams();
  return <AppSectionScreen sectionKey={parseAppShellSectionKey(section) ?? section} />;
}
