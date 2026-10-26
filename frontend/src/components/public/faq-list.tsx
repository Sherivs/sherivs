import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { FAQ_CATEGORIES, FAQ_ITEMS, type FaqItem } from "@/lib/public-site/faq";
import { inputClass } from "@/components/public/ui";

export function FaqList({ items = FAQ_ITEMS, preview = false }: { items?: readonly FaqItem[]; preview?: boolean }) {
  const [query, setQuery] = useState("");
  const [hash, setHash] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const apply = () => setHash(window.location.hash.replace(/^#/, ""));
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.question.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q),
    );
  }, [items, query]);

  const grouped = FAQ_CATEGORIES.map((category) => ({
    category,
    items: filtered.filter((item) => item.category === category),
  })).filter((group) => group.items.length);

  return (
    <div>
      {!preview ? (
        <div className="mb-8 max-w-xl">
          <label htmlFor="faq-search" className="text-sm font-medium">
            Search questions
          </label>
          <input
            id="faq-search"
            type="search"
            className={`${inputClass} mt-2`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Identity, twins, Scholar…"
          />
        </div>
      ) : null}
      {grouped.length === 0 ? (
        <p className="text-sm text-sherivs-muted">No questions match that search.</p>
      ) : (
        grouped.map((group) => (
          <div key={group.category} className="mb-10">
            {!preview ? (
              <h2 className="font-display text-lg font-semibold">{group.category}</h2>
            ) : null}
            <div className="mt-3 divide-y divide-[var(--sherivs-border)] rounded-[var(--sherivs-radius)] border border-[var(--sherivs-border)]">
              {group.items.map((item) => (
                <details
                  key={item.id}
                  id={item.id}
                  open={hash === item.id || preview}
                  className="px-4 py-3"
                >
                  <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">
                    <Link to="/faq" hash={item.id} className="text-sherivs-white hover:text-sherivs-cyan">
                      {item.question}
                    </Link>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-sherivs-muted">{item.answer}</p>
                  {item.related.length ? (
                    <ul className="mt-3 flex flex-wrap gap-3 text-sm">
                      {item.related.map((rel) => (
                        <li key={rel.href}>
                          <Link to={rel.href as never} className="text-sherivs-cyan underline-offset-4 hover:underline">
                            {rel.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </details>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
