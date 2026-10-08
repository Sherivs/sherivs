import { SHERIVS_BRAND } from "@/lib/brand/sherivs-brand";
import {
  INSTALLED_RUNTIME_PROOFS,
  SECURITY_GUARANTEES,
  SITE_CAPABILITIES,
} from "@/routes/(site)/-content/site-content";
import { EXECUTION_PATH_STAGES } from "@/lib/missions/mission-execution";
import { SherivsFrame } from "@/components/sherivs/editorial-page";
import { PLATFORM_PAGE_DESCRIPTION } from "@/lib/platform";

const PLANES = [
  {
    index: "01",
    name: "Reality",
    text: "People, records, relationships, events and state. This layer is what the organization can stand behind.",
  },
  {
    index: "02",
    name: "Intelligence",
    text: "Context, memory and knowledge. Derived. Labeled. Never allowed to overwrite a verified record on its own.",
  },
  {
    index: "03",
    name: "Action",
    text: "Missions and a governed AI workforce. Authority stays with the organization that assigned the work.",
  },
  {
    index: "04",
    name: "Evidence",
    text: "What was done, by whom, under which policy, and whether an independent verifier accepted it.",
  },
] as const;

const STAGE_COPY: Record<(typeof EXECUTION_PATH_STAGES)[number], string> = {
  assigned: "An authorized actor gives the work to a worker.",
  leased: "The worker holds the mission for a bounded time.",
  evidenced: "The outcome is bound to a source, an actor and a time.",
  verified: "Someone other than the worker accepts or rejects it.",
  requeued: "Failure returns the mission, within an attempt limit.",
  exhausted: "The attempt limit ends the path.",
  denied: "Admission can refuse the mission outright.",
};

export function SherivsPublicHome() {
  const [runtime] = INSTALLED_RUNTIME_PROOFS;

  return (
    <SherivsFrame home>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: SHERIVS_BRAND.customerName,
            url: `${SHERIVS_BRAND.publicOrigin}/`,
            description: PLATFORM_PAGE_DESCRIPTION,
          }),
        }}
      />
      <section className="sx-intro" aria-labelledby="sx-brand-intro">
        <div className="sx-frame">
          <p className="sx-kicker">01 — {SHERIVS_BRAND.publicDomain}</p>
          <h1 id="sx-brand-intro">{SHERIVS_BRAND.customerName}</h1>
          <p className="sx-statement">{SHERIVS_BRAND.category}.</p>
        </div>
      </section>

      <section className="sx-chapter" aria-labelledby="sx-category">
        <div className="sx-frame sx-split">
          <p className="sx-kicker" id="sx-category">
            02 — Category
          </p>
          <div>
            <h2>Organizations need an operational layer that can tell the truth.</h2>
            <p>
              Most software starts with a screen. Sherivs starts with the organization: who is
              accountable, what is known, what may be done, and what evidence remains. The
              interface is a consequence of that model.
            </p>
          </div>
        </div>
      </section>

      <section className="sx-chapter" aria-labelledby="sx-planes">
        <div className="sx-frame">
          <p className="sx-kicker" id="sx-planes">
            03 — From reality to evidence
          </p>
          <ol className="sx-planes">
            {PLANES.map((plane) => (
              <li key={plane.name}>
                <span>{plane.index}</span>
                <div>
                  <h2>{plane.name}</h2>
                  <p>{plane.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="sx-chapter" aria-labelledby="sx-capabilities">
        <div className="sx-frame">
          <p className="sx-kicker" id="sx-capabilities">
            04 — What the platform holds
          </p>
          <dl className="sx-defs">
            {SITE_CAPABILITIES.map((capability) => (
              <div key={capability.id}>
                <dt>{capability.title}</dt>
                <dd>{capability.description}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="sx-chapter" aria-labelledby="sx-missions">
        <div className="sx-frame">
          <p className="sx-kicker" id="sx-missions">
            05 — Mission path
          </p>
          <h2>A mission is not finished when a worker says it is.</h2>
          <ol className="sx-process sx-process-compact">
            {EXECUTION_PATH_STAGES.map((stage) => (
              <li key={stage}>
                <strong>{stage}</strong>
                <p>{STAGE_COPY[stage]}</p>
              </li>
            ))}
          </ol>
          <p className="sx-note">
            <a href="/platform/missions">Read the mission path</a>
          </p>
        </div>
      </section>

      <section className="sx-chapter" aria-labelledby="sx-runtime">
        <div className="sx-frame sx-split">
          <p className="sx-kicker" id="sx-runtime">
            06 — Domain runtime
          </p>
          <div>
            <h2>Installed runtime: {runtime.name}. The kernel remains the kernel.</h2>
            <p>{runtime.description}</p>
            <p>{runtime.proof}</p>
            <p className="sx-note">
              <a href="/solutions/education">Education runtime</a>
            </p>
          </div>
        </div>
      </section>

      <section className="sx-chapter" aria-labelledby="sx-governance">
        <div className="sx-frame">
          <p className="sx-kicker" id="sx-governance">
            07 — Governance
          </p>
          <dl className="sx-defs">
            {SECURITY_GUARANTEES.map((guarantee) => (
              <div key={guarantee.id}>
                <dt>{guarantee.title}</dt>
                <dd>{guarantee.description}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="sx-chapter sx-close" aria-labelledby="sx-cta">
        <div className="sx-frame sx-split">
          <p className="sx-kicker" id="sx-cta">
            08 — Begin
          </p>
          <div>
            <h2>Evaluate the platform through an account, not a brochure form.</h2>
            <p>
              {SHERIVS_BRAND.executiveIntelligence} is the name of executive intelligence inside
              Sherivs. It answers inside the same authority model as every other worker.
            </p>
            <p className="sx-actions">
              <a className="sx-button" href="/auth">
                Create an account
              </a>
              <a className="sx-textlink" href="/platform">
                Explore the platform
              </a>
            </p>
          </div>
        </div>
      </section>
    </SherivsFrame>
  );
}
