import { createFileRoute } from "@tanstack/react-router";
import { PageTitle } from "@/components/sherivs/page-chrome";
import { SystemState } from "@/components/sherivs/states";
import { Container, DefinitionRows, SvLink } from "@/components/sherivs/primitives";
import {
  CONTENT_KIND_LABELS,
  PUBLIC_CONTENT_KINDS,
  PUBLISHED_CONTENT,
  contentPath,
  publicContent,
} from "@/lib/experience-system/content";
import { publicHead } from "@/lib/experience-system/seo";

export const Route = createFileRoute("/(site)/resources/")({
  component: ResourcesIndex,
  head: () => {
    const empty = publicContent(PUBLISHED_CONTENT, new Date()).length === 0;
    return publicHead({ path: "/resources", noindex: empty });
  },
});

function ResourcesIndex() {
  const items = publicContent(PUBLISHED_CONTENT, new Date());
  return (
    <>
      <PageTitle
        path="/resources"
        eyebrow="Resources"
        title="Guides, case studies, changelog and documentation."
        lead="Everything published here is written and approved by Sherivs. Nothing is placeholder copy."
      />
      <Container className="py-12 sm:py-16">
        {items.length === 0 ? (
          <SystemState
            kind="empty"
            title="Nothing has been published yet"
            description="No guides, case studies, changelog entries or documentation have been approved for publication. This page will list them when they exist."
          />
        ) : (
          <>
            <nav aria-label="Content types" className="mb-10 flex flex-wrap gap-3">
              {PUBLIC_CONTENT_KINDS.filter((k) => items.some((i) => i.kind === k)).map((k) => (
                <SvLink key={k} to={`/resources/${k}`} className="text-sv-accent-text">
                  {CONTENT_KIND_LABELS[k]}
                </SvLink>
              ))}
              <a href="/resources/rss.xml" className="ml-auto text-sv-accent-text">
                RSS feed
              </a>
            </nav>
            <DefinitionRows
              rows={items.map((i) => ({
                key: `${i.kind}-${i.slug}`,
                term: (
                  <SvLink to={contentPath(i)} className="no-underline hover:underline">
                    {i.title}
                  </SvLink>
                ),
                detail: i.description,
                note: `${CONTENT_KIND_LABELS[i.kind]} · ${new Date(i.publishedAt ?? "").toDateString()}`,
              }))}
            />
          </>
        )}
      </Container>
    </>
  );
}
