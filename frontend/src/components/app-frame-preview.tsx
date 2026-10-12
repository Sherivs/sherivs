/**
 * Sherivs — app-frame preview (dev/QA surface).
 *
 * A floating "phone-sized" side popup so the R-001 workspace UI can be tested
 * at app proportions while working on a desktop browser. Opens a right-side
 * panel containing a device-framed, same-origin iframe of the CURRENT route
 * (session is shared, so the preview behaves exactly like the live app).
 * Desktop-only; renders nothing on phone/tablet viewports.
 */
import { useEffect, useState } from "react";
import { MonitorSmartphone, X, ExternalLink } from "lucide-react";
import { useClientPlatform } from "@/lib/use-client-platform";

export function AppFramePreview() {
  const { breakpoint } = useClientPlatform();
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("/");

  const desktop = breakpoint !== "xs" && breakpoint !== "sm";

  useEffect(() => {
    if (!open) return;
    setPath(window.location.pathname + window.location.search);
  }, [open]);

  if (!desktop) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Open app-size preview"
        title="Preview the UI at app size"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-[80] grid size-11 place-items-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-lg backdrop-blur hover:text-foreground"
      >
        <MonitorSmartphone className="size-5" />
      </button>

      {open && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[90] bg-black/30"
          />
          <aside
            role="dialog"
            aria-label="App-size preview"
            className="fixed inset-y-0 right-0 z-[100] flex w-[min(94vw,430px)] flex-col border-l border-border bg-background shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <div className="text-sm font-semibold">App preview</div>
              <div className="flex items-center gap-1.5">
                <a
                  href={path}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  title="Open this page in a new tab"
                >
                  <ExternalLink className="size-4" />
                </a>
                <button
                  type="button"
                  aria-label="Close preview"
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden p-4">
              <div className="relative mx-auto h-full w-full max-w-[390px] overflow-hidden rounded-[2.2rem] border-[10px] border-neutral-800 bg-white shadow-inner dark:border-neutral-700">
                <div className="pointer-events-none absolute left-1/2 top-0 z-10 h-5 w-28 -translate-x-1/2 rounded-b-2xl bg-neutral-900 dark:bg-neutral-700" />
                <iframe
                  key={path}
                  src={path}
                  title="Workspace at app size"
                  className="h-full w-full border-0 bg-white"
                />
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
