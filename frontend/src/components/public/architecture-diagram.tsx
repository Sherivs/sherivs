import { Link } from "@tanstack/react-router";
import { ARCHITECTURE_LAYERS } from "@/lib/public-site/capabilities";
import { StatusBadge } from "@/components/public/ui";

const HREF: Record<string, string> = {
  identity: "/product/architecture",
  "institutional-computing": "/product/institutional-computing",
  "agent-orchestration": "/product/ai-workforce",
  "digital-twin-runtime": "/product/digital-twins",
  "intelligence-routing": "/product/intelligence",
  execution: "/product/architecture",
  "data-memory": "/product/architecture",
  observability: "/security",
};

export function ArchitectureDiagram() {
  return (
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {ARCHITECTURE_LAYERS.map((layer, index) => (
        <li key={layer.id}>
          <Link
            to={(HREF[layer.id] ?? "/product/architecture") as never}
            className="sherivs-glass-card flex h-full flex-col rounded-[var(--sherivs-radius)] p-4 transition-transform duration-[var(--sherivs-motion-fast)] hover:-translate-y-0.5"
          >
            <span className="font-display text-xs font-bold text-sherivs-cyan">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-2 font-display text-sm font-semibold">{layer.title}</h3>
            <p className="mt-2 flex-1 text-xs leading-relaxed text-sherivs-muted">
              {layer.summary}
            </p>
            <div className="mt-3">
              <StatusBadge status={layer.status} />
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}
