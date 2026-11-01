import { useEffect, useState, type ComponentType } from "react";
import { createFileRoute } from "@tanstack/react-router";

type PreviewComponent = ComponentType;

function WorkspacePreviewRoute() {
  const [Preview, setPreview] = useState<PreviewComponent | null>(null);
  const [access, setAccess] = useState<"checking" | "denied" | "allowed">("checking");

  useEffect(() => {
    const enabled =
      import.meta.env.DEV === true &&
      (import.meta.env as ImportMetaEnv & { VITE_WORKSPACE_VISUAL_FIXTURE?: string })
        .VITE_WORKSPACE_VISUAL_FIXTURE === "1" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    if (!enabled) {
      setAccess("denied");
      return;
    }
    setAccess("allowed");
    let active = true;
    void import("@/components/workspaces/fixtures/workspace-preview").then(
      ({ WorkspaceFixturePreview }) => {
        if (active) setPreview(() => WorkspaceFixturePreview);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  if (access === "checking") {
    return <p role="status">Loading local demo workspace fixtures…</p>;
  }
  if (access === "denied") return <p>Workspace preview unavailable.</p>;
  if (!Preview) return <p role="status">Loading local demo workspace fixtures…</p>;
  return <Preview />;
}

export const Route = createFileRoute("/workspace-preview")({
  component: WorkspacePreviewRoute,
  head: () => ({ meta: [{ title: "Local workspace preview — Demo data" }] }),
});
