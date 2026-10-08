import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { PageHeader, Section } from "@/components/sherivs/public-shell";
import { StateView } from "@/components/sherivs/state-view";
import { CONTENT_SECTIONS, SECTION_META, contentPath, searchItems, visibleItems } from "@/lib/sherivs/content";
import { PUBLISHED_CONTENT } from "@/lib/sherivs/content-registry";
import { publicHead } from "@/lib/sherivs/page-head";

const Search = z.object({ q: z.string().max(120).optional().catch(undefined) });

export const Route = createFileRoute("/(site)/resources/")({
  validateSearch: Search,
  component: ResourcesIndex,
  head: () =>
    publicHead({
      path: "/resources",
      title: "Resources",
      description: "Documentation, guides, case studies and release notes for Sherivs.",
      breadcrumbs: true,
    }),
});

function ResourcesIndex() {
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: "/resources/" });
  const [draft, setDraft] = useState(q ?? "");
  const results = q ? searchItems(PUBLISHED_CONTENT, q) : [];

  return (
    <>
      <PageHeader
        path="/resources"
        eyebrow="Resources"
        title="Documentation and release notes."
        lead="Everything published here has been reviewed. Sections with nothing published say so."
      >
        <form
          role="search"
          aria-label="Search resources"
          className="flex max-w-xl gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            navigate({ search: { q: draft.trim() || undefined } });
          }}
        >
          <label htmlFor="resource-search" className="sr-only">
            Search resources
          </label>
          <input
            id="resource-search"
            type="search"
            value={draft}
            maxLength={120}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search documentation and release notes"
            className="sv-focusable min-h-11 flex-1 rounded-[var(--sv-radius-md)] border border-[color:var(--sv-line-strong)] bg-[color:var(--sv-ground)] px-3 sv-small"
          />
          <button type="submit" className="sv-btn sv-btn-primary">
            Search
          </button>
        </form>
      </PageHeader>

      {q ? (
        <Section id="results" title={`Results for “${q}”`}>
          {results.length === 0 ? (
            <StateView kind="empty" title="No matches" description="Nothing published matches that search." />
          ) : (
            <ul className="grid">
              {results.map((r) => (
                <li key={`${r.section}/${r.slug}`} className="sv-rule py-5">
                  <Link to={contentPath(r)} className="sv-focusable grid gap-1">
                    <span className="sv-label sv-muted">{SECTION_META[r.section].title}</span>
                    <span className="sv-h3">{r.title}</span>
                    <span className="sv-small sv-muted">{r.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      <Section id="sections" tone="ground" title="Sections">
        <ul className="grid gap-px overflow-hidden rounded-[var(--sv-radius-lg)] border border-[color:var(--sv-line)] bg-[color:var(--sv-line)] md:grid-cols-2">
          {CONTENT_SECTIONS.map((s) => {
            const count = visibleItems(PUBLISHED_CONTENT, s).length;
            return (
              <li key={s} className="sv-ground">
                <Link
                  to="/resources/$section"
                  params={{ section: s }}
                  className="sv-focusable grid h-full content-start gap-2 p-6 hover:bg-[color:color-mix(in_oklab,var(--sv-text)_4%,transparent)]"
                >
                  <span className="sv-h2">{SECTION_META[s].title}</span>
                  <span className="sv-small sv-muted">{SECTION_META[s].description}</span>
                  <span className="sv-label sv-faint">{count === 0 ? "Nothing published yet" : `${count} published`}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}
