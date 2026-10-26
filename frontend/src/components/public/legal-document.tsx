import { LEGAL_DOCUMENTS, type LegalDocument } from "@/lib/public-site/legal";
import { Callout, PageContainer, PageHero } from "@/components/public/ui";
import { PUBLIC_CONTACTS } from "@/lib/public-site/contacts";

export function LegalDocumentView({ slug }: { slug: string }) {
  const doc = LEGAL_DOCUMENTS.find((item) => item.slug === slug);
  if (!doc) return <p className="p-8">This policy is not available.</p>;
  return <LegalBody doc={doc} />;
}

function LegalBody({ doc }: { doc: LegalDocument }) {
  return (
    <>
      <PageHero
        eyebrow="Legal"
        title={doc.title}
        lead={doc.summary}
        id={`${doc.id}-heading`}
      />
      <PageContainer className="max-w-[var(--sherivs-prose)] space-y-8 py-12">
        {doc.status !== "published_placeholder" ? (
          <Callout title="Pending legal and owner review" tone="warning">
            This page is a structural draft. It is not a finalized policy and must not be treated as
            contractual language. Unresolved facts are listed below.
          </Callout>
        ) : (
          <Callout title="Placeholder policy" tone="warning">
            This summary reflects implemented product principles. A counsel-reviewed policy must
            replace it before regulated deployment.
          </Callout>
        )}
        {doc.sections.map((section) => (
          <div key={section.heading}>
            <h2 className="font-display text-lg font-semibold">{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="mt-2 text-sm leading-relaxed text-sherivs-muted">
                {paragraph}
              </p>
            ))}
          </div>
        ))}
        <div>
          <h2 className="font-display text-lg font-semibold">Unresolved facts for owner review</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-sherivs-muted">
            {doc.unresolvedFacts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-sherivs-muted">
            Legal contact:{" "}
            <a className="text-sherivs-cyan underline-offset-4 hover:underline" href={`mailto:${PUBLIC_CONTACTS.info}`}>
              {PUBLIC_CONTACTS.info}
            </a>
          </p>
        </div>
      </PageContainer>
    </>
  );
}
