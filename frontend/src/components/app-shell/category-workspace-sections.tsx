import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { CategoryWorkspaceView } from "@/lib/workspaces/category-workspace";

/** Renders category workspaces. Presentation only: all data is permission-filtered upstream. */
export function CategoryWorkspaceSections({ views }: { views: readonly CategoryWorkspaceView[] }) {
  if (views.length === 0) return null;
  return (
    <>
      {views.map((view) => (
        <section
          key={view.id}
          className="app-shell-widget-section"
          aria-labelledby={`category-${view.id}-heading`}
          data-testid={`category-workspace-${view.id}`}
        >
          <div className="app-shell-section-title">
            <h2 id={`category-${view.id}-heading`}>{view.title}</h2>
          </div>
          <p className="app-shell-empty">{view.summary}</p>
          {view.queues.length ? (
            <div className="app-shell-cards">
              {view.queues.map((item) => (
                <Link
                  className="app-shell-card"
                  key={item.key}
                  to={item.href as never}
                  aria-label={`Open ${item.label}`}
                >
                  <div>
                    <p>{item.label}</p>
                    <strong>{item.value}</strong>
                    <small>{item.source}</small>
                  </div>
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              ))}
            </div>
          ) : null}
          {view.actions.length ? (
            <>
              <div className="app-shell-section-title">
                <h3>Daily actions</h3>
              </div>
              <div className="app-shell-cards">
                {view.actions.map((item) => (
                  <Link
                    className="app-shell-card"
                    key={item.key}
                    to={item.href as never}
                    aria-label={item.label}
                  >
                    <div>
                      <p>{item.label}</p>
                    </div>
                    <ChevronRight size={16} aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </>
          ) : null}
          {view.notConfigured.map((item) => (
            <p className="app-shell-empty" key={item.label}>
              {item.label}: not configured. {item.reason}
            </p>
          ))}
        </section>
      ))}
    </>
  );
}
