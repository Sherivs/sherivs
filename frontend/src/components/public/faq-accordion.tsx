import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { FaqItem } from "@/lib/public-site/faq";
import { PublicLink } from "@/components/public/public-link";

export function FaqAccordion({
  items,
  allowMultiple = false,
}: {
  items: readonly FaqItem[];
  allowMultiple?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(items[0]?.id ?? null);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const apply = () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (hash && items.some((item) => item.id === hash)) setOpenId(hash);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [items]);

  const isOpen = (id: string) => (allowMultiple ? openIds.has(id) : openId === id);

  const toggle = (id: string) => {
    if (allowMultiple) {
      setOpenIds((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    setOpenId((current) => (current === id ? null : id));
  };

  return (
    <div className="sherivs-glass-card divide-y divide-[var(--sherivs-border)] rounded-[var(--sherivs-radius)]">
      {items.map((item) => {
        const expanded = isOpen(item.id);
        const panelId = `faq-panel-${item.id}`;
        return (
          <div key={item.id} id={item.id} className="px-4 sm:px-5">
            <h3 className="m-0">
              <button
                type="button"
                className="flex min-h-14 w-full items-center justify-between gap-4 py-4 text-left text-sm font-medium text-[var(--sherivs-ink)] sm:text-base"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
              >
                <span>{item.question}</span>
                <ChevronDown
                  size={18}
                  aria-hidden="true"
                  className="sherivs-disclosure-icon pointer-events-none shrink-0 text-sherivs-muted"
                />
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              hidden={!expanded}
              className="grid transition-[grid-template-rows] duration-[var(--sherivs-motion)]"
            >
              {expanded ? (
                <div className="pb-5">
                  <p className="max-w-2xl text-sm leading-relaxed text-sherivs-muted">
                    {item.answer}
                  </p>
                  {item.related.length ? (
                    <ul className="mt-3 flex flex-wrap gap-3 text-sm">
                      {item.related.map((rel) => (
                        <li key={rel.href}>
                          <PublicLink
                            href={rel.href}
                            className="text-sherivs-cyan underline-offset-4 hover:underline"
                          >
                            {rel.label}
                          </PublicLink>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
