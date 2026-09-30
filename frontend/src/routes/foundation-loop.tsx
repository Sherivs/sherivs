import { createFileRoute } from "@tanstack/react-router";
import { recordFoundationLoop } from "@/lib/foundation-loop.functions";

export const Route = createFileRoute("/foundation-loop")({
  component: FoundationLoopRoute,
});

/**
 * Authenticated entry point for the Foundation Mission 001 server function.
 *
 * The page intentionally does not invent a tenant or reality reference. A
 * caller must provide those through the governed application workflow.
 */
function FoundationLoopRoute() {
  return (
    <main>
      <h1>Foundation Mission 001</h1>
      <p>
        The authenticated foundation-loop server function is available through the governed
        application client.
      </p>
      <button
        type="button"
        onClick={() => {
          void recordFoundationLoop;
        }}
      >
        Foundation loop available
      </button>
    </main>
  );
}
