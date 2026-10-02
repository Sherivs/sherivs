import { createFileRoute } from "@tanstack/react-router";
import { scholarFoundationLoop } from "@/lib/runtime/scholar/scholar-foundation-loop.functions";

export const Route = createFileRoute("/scholar-foundation-loop")({
  component: ScholarFoundationLoopRoute,
});

/**
 * Authenticated entry point for the Scholar foundation validation server
 * function (Gate 14 loop, extended with governed relationship and event
 * vocabulary).
 *
 * The page intentionally does not invent a tenant, entity type, or
 * relationship target. A caller must provide those through the governed
 * application workflow.
 */
function ScholarFoundationLoopRoute() {
  return (
    <main>
      <h1>Scholar Foundation Validation</h1>
      <p>
        The authenticated Scholar foundation-loop server function is available through the governed
        application client.
      </p>
      <button
        type="button"
        onClick={() => {
          void scholarFoundationLoop;
        }}
      >
        Scholar foundation loop available
      </button>
    </main>
  );
}
