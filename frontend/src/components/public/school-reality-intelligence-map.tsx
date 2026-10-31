import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronDown } from "lucide-react";
import { PageContainer, Section } from "@/components/public/ui";
import {
  SCHOOL_REALITY_BRANCHES,
  SCHOOL_REALITY_CAPABILITIES,
  SCHOOL_REALITY_FLOW,
  SCHOOL_REALITY_GENERATIONS,
  SCHOOL_REALITY_MAP,
  SCHOOL_REALITY_PATHS,
  branchById,
  pathsTouchingBranch,
  tracedPathForBranch,
  type SchoolRealityBranch,
} from "@/lib/public-site/school-reality-map";
import {
  organismLayout,
  type Box,
  type OrganismLayout,
} from "@/lib/public-site/school-reality-organism";

const ORGANISM = organismLayout();

/**
 * Explanatory map of a school as one living institution.
 * Desktop: an SVG organism with curved trunks, activity twigs, and five arcs.
 * Below 1024px: a small radial sketch, then an expandable list.
 */

function buttonId(branchId: string): string {
  return `reality-branch-${branchId}`;
}

function panelId(branchId: string): string {
  return `reality-panel-${branchId}`;
}

function nodeButtonId(branchId: string): string {
  return `reality-node-${branchId}`;
}

export function SchoolRealityIntelligenceMap() {
  const rootRef = useRef<HTMLElement>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [pathId, setPathId] = useState<string | null>(null);
  const activePath = SCHOOL_REALITY_PATHS.find((path) => path.id === pathId);
  const related = new Set(activePath?.branchIds ?? []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;

    const reveal = () => {
      root.dataset.revealed = "true";
    };
    root.dataset.motion = "on";
    const rect = root.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 64) {
      reveal();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          reveal();
          observer.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(root);
    const timeout = window.setTimeout(reveal, 4000);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, []);

  const toggleBranch = (id: string) => {
    setBranchId((current) => {
      if (current === id) {
        setPathId(null);
        return null;
      }
      setPathId(branchById(id)?.tracePathId ?? null);
      return id;
    });
  };

  const togglePath = (id: string) => {
    setPathId((current) => (current === id ? null : id));
  };

  return (
    <Section id="school-reality" labelledBy="school-reality-title" className="sherivs-map-section">
      <PageContainer className="py-8 sm:py-12 lg:py-14">
        <p id="school-reality-desc" className="sr-only">
          {SCHOOL_REALITY_MAP.description}
        </p>
        <h2
          id="school-reality-title"
          className="sherivs-display max-w-[22ch] text-2xl font-bold sm:text-3xl"
        >
          {SCHOOL_REALITY_MAP.introTitle}
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--sherivs-ink)] sm:text-base">
          {SCHOOL_REALITY_MAP.introBody}
        </p>

        <figure
          ref={rootRef}
          className="sherivs-map"
          data-testid="school-reality-map"
          aria-describedby="school-reality-honesty"
        >
          <p className="sr-only">
            {SCHOOL_REALITY_MAP.centreTitle}. {SCHOOL_REALITY_MAP.centreBody}
          </p>
          <div className="sherivs-glass-card sherivs-map-card">
            <DesktopOrganism
              branchId={branchId}
              pathId={pathId}
              related={related}
              onToggle={toggleBranch}
            />
            <div className="sherivs-map-mini">
              <MiniOrganism />
              <div className="sherivs-map-nucleus">
                <p className="sherivs-map-centre-title" data-sri-label>
                  {SCHOOL_REALITY_MAP.centreTitle}
                </p>
                <p className="sherivs-map-centre-body" data-sri-label>
                  {SCHOOL_REALITY_MAP.centreBody}
                </p>
              </div>
            </div>
            <div className="sherivs-map-list">
              {SCHOOL_REALITY_BRANCHES.map((branch) => (
                <Branch
                  key={branch.id}
                  branch={branch}
                  open={branchId === branch.id}
                  related={related.has(branch.id) && branchId !== branch.id}
                  onToggle={toggleBranch}
                />
              ))}
            </div>

            <div className="sherivs-map-stem" aria-hidden="true" />
            <div className="sherivs-map-digital">
              <h3 className="sherivs-map-digital-title" data-sri-label>
                {SCHOOL_REALITY_MAP.digitalTitle}
              </h3>
              <ol className="sherivs-map-flow">
                {SCHOOL_REALITY_FLOW.map((step, index) => (
                  <li key={step.index}>
                    <span className="sherivs-map-step-index">
                      {step.index}
                      {index < SCHOOL_REALITY_FLOW.length - 1 ? (
                        <span aria-hidden="true"> →</span>
                      ) : null}
                    </span>
                    <span className="sherivs-map-step-label" data-sri-label>
                      {step.label}
                    </span>
                    {step.inDevelopment ? <DirectionMark /> : null}
                  </li>
                ))}
              </ol>
              <ul className="sherivs-map-capabilities">
                {SCHOOL_REALITY_CAPABILITIES.map((capability) => (
                  <li key={capability.id}>
                    <p className="sherivs-map-cap-title" data-sri-label>
                      {capability.title}
                      {capability.inDevelopment ? <DirectionMark /> : null}
                    </p>
                    <p className="sherivs-map-quiet" data-sri-label>
                      {capability.body}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="sherivs-map-direction-note">{SCHOOL_REALITY_MAP.digitalDirection}</p>
              <p className="sherivs-map-product">
                <span className="sherivs-map-product-name" data-sri-label>
                  {SCHOOL_REALITY_MAP.productName}
                </span>
                <span className="sherivs-map-product-tag" data-sri-label>
                  {SCHOOL_REALITY_MAP.productTagline}
                </span>
              </p>
            </div>

            <div className="sherivs-map-paths">
              <h3 className="sherivs-map-kicker">{SCHOOL_REALITY_MAP.pathwaysTitle}</h3>
              <p className="sherivs-map-quiet">{SCHOOL_REALITY_MAP.pathwaysLead}</p>
              <ul className="sherivs-map-legend">
                {SCHOOL_REALITY_PATHS.map((path) => {
                  const pressed = path.id === pathId;
                  const linked = Boolean(branchId && path.branchIds.includes(branchId) && !pressed);
                  return (
                    <li
                      key={path.id}
                      data-path-state={pressed ? "traced" : linked ? "linked" : "idle"}
                    >
                      <button
                        type="button"
                        className="sherivs-map-legend-btn"
                        aria-pressed={pressed}
                        onClick={() => togglePath(path.id)}
                      >
                        <span className="sherivs-map-path-mark" aria-hidden="true" />
                        <span data-sri-label>{path.title}</span>
                      </button>
                      <p data-sri-label>
                        {path.body}
                        {pressed ? <span className="sherivs-map-flag"> Showing</span> : null}
                        {linked ? <span className="sherivs-map-flag"> Linked</span> : null}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="sherivs-map-shift">
              <p className="sherivs-map-positioning">{SCHOOL_REALITY_MAP.positioning}</p>
              <div className="sherivs-map-shift-grid">
                <Generation generation={SCHOOL_REALITY_GENERATIONS[0]} />
                <p className="sherivs-map-progression" data-sri-label>
                  {SCHOOL_REALITY_MAP.progression}
                </p>
                <Generation generation={SCHOOL_REALITY_GENERATIONS[1]} />
              </div>
            </div>
          </div>
          <figcaption className="sherivs-map-caption">
            <p data-sri-label>{SCHOOL_REALITY_MAP.caption}</p>
            <p id="school-reality-honesty" className="sherivs-map-honesty" data-sri-label>
              {SCHOOL_REALITY_MAP.honesty}
            </p>
          </figcaption>
        </figure>
      </PageContainer>
    </Section>
  );
}

function percentBox(rect: Box, layout: OrganismLayout): CSSProperties {
  return {
    left: `${(rect.x / layout.width) * 100}%`,
    top: `${(rect.y / layout.height) * 100}%`,
    width: `${(rect.w / layout.width) * 100}%`,
    height: `${(rect.h / layout.height) * 100}%`,
  };
}

function DesktopOrganism({
  branchId,
  pathId,
  related,
  onToggle,
}: {
  branchId: string | null;
  pathId: string | null;
  related: Set<string>;
  onToggle: (id: string) => void;
}) {
  const activeAnchors = new Set(
    (SCHOOL_REALITY_PATHS.find((path) => path.id === pathId)?.anchors ?? []).map(
      (anchor) => `${anchor.branchId}:${anchor.label}`,
    ),
  );
  const selected = branchById(branchId ?? "");
  return (
    <div className="sherivs-map-desktop">
      <div className="sherivs-map-stage" data-tracing={pathId ? "true" : "false"}>
        <svg
          className="sherivs-map-svg"
          viewBox={`0 0 ${ORGANISM.width} ${ORGANISM.height}`}
          role="img"
          aria-describedby="school-reality-desc"
        >
          <ellipse
            className="sherivs-map-nucleus-shape"
            cx={ORGANISM.nucleus.cx}
            cy={ORGANISM.nucleus.cy}
            rx={ORGANISM.nucleus.rx}
            ry={ORGANISM.nucleus.ry}
          />
          {ORGANISM.curves.map((curve) => (
            <path
              key={curve.id}
              d={curve.d}
              pathLength={1}
              data-sri-stroke={curve.kind}
              data-path={curve.pathId ?? ""}
              data-active={curve.kind === "arc" && curve.pathId === pathId ? "true" : "false"}
              className={`sherivs-map-stroke sherivs-map-stroke-${curve.kind}`}
            />
          ))}
          {ORGANISM.nodes.map((node) => {
            const onPath =
              node.kind === "activity"
                ? activeAnchors.has(`${node.branchId}:${node.label ?? ""}`)
                : Boolean(pathId && related.has(node.branchId));
            return (
              <circle
                key={node.id}
                cx={node.point.x}
                cy={node.point.y}
                r={node.kind === "domain" ? 5.5 : 3.2}
                className={onPath ? "sherivs-map-dot is-on-path" : "sherivs-map-dot"}
              />
            );
          })}
          {ORGANISM.labels.map((label) => (
            <text
              key={label.id}
              x={label.x}
              y={label.y}
              textAnchor={label.anchor}
              fontSize={label.size}
              className={
                label.id.startsWith("activity")
                  ? "sherivs-map-svg-activity"
                  : label.id.startsWith("centre")
                    ? "sherivs-map-svg-centre"
                    : "sherivs-map-svg-heading"
              }
              data-sri-label=""
            >
              {label.text}
            </text>
          ))}
        </svg>
        {ORGANISM.hits.map((hit) => {
          const branch = branchById(hit.branchId);
          if (!branch) return null;
          const state =
            branchId === branch.id
              ? "selected"
              : pathId && related.has(branch.id)
                ? "related"
                : "idle";
          return (
            <button
              key={branch.id}
              type="button"
              id={nodeButtonId(branch.id)}
              className="sherivs-map-hit"
              style={percentBox(hit.rect, ORGANISM)}
              data-state={state}
              aria-label={`${branch.index} ${branch.heading}`}
              aria-expanded={branchId === branch.id}
              aria-controls="reality-desktop-detail"
              onClick={() => onToggle(branch.id)}
            />
          );
        })}
      </div>
      <div
        id="reality-desktop-detail"
        role="region"
        aria-labelledby={branchId ? nodeButtonId(branchId) : undefined}
        hidden={!selected}
        className="sherivs-map-panel"
      >
        {selected ? <BranchDetail branch={selected} /> : null}
      </div>
    </div>
  );
}

function MiniOrganism() {
  const cx = 160;
  const cy = 86;
  const radius = 68;
  const inner = 32;
  return (
    <svg className="sherivs-map-mini-svg" viewBox="0 0 320 176" aria-hidden="true">
      {SCHOOL_REALITY_BRANCHES.map((branch, index) => {
        const angle = ((-90 + index * 45) * Math.PI) / 180;
        const x2 = cx + Math.cos(angle) * radius;
        const y2 = cy + Math.sin(angle) * radius;
        const x1 = cx + Math.cos(angle) * (inner + 4);
        const y1 = cy + Math.sin(angle) * (inner + 4);
        const labelY = y2 + (Math.sin(angle) >= 0.2 ? 14 : Math.sin(angle) <= -0.2 ? -8 : 4);
        return (
          <g key={branch.id}>
            <line
              className="sherivs-map-stroke sherivs-map-stroke-trunk"
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
            />
            <circle className="sherivs-map-dot" cx={x2} cy={y2} r={3} />
            <text
              x={x2}
              y={labelY}
              textAnchor="middle"
              fontSize={12}
              className="sherivs-map-svg-heading"
              data-sri-label=""
            >
              {branch.index}
            </text>
          </g>
        );
      })}
      <circle className="sherivs-map-nucleus-shape" cx={cx} cy={cy} r={inner} />
    </svg>
  );
}

function DirectionMark() {
  return <span className="sherivs-map-direction">In development</span>;
}

function Generation({ generation }: { generation: (typeof SCHOOL_REALITY_GENERATIONS)[number] }) {
  return (
    <article className="sherivs-map-generation">
      <p className="sherivs-map-kicker" data-sri-label>
        {generation.kicker}
      </p>
      <p className="sherivs-map-generation-subject" data-sri-label>
        {generation.subject}
      </p>
      <p className="sherivs-map-quiet" data-sri-label>
        {generation.body}
      </p>
      <ul className="sherivs-map-examples">
        {generation.examples.map((example) => (
          <li key={example} data-sri-label>
            {example}
          </li>
        ))}
      </ul>
    </article>
  );
}

function BranchDetail({ branch }: { branch: SchoolRealityBranch }) {
  const traced = tracedPathForBranch(branch.id);
  const others = pathsTouchingBranch(branch.id).filter((path) => path.id !== traced?.id);
  return (
    <>
      <ul className="sherivs-map-activities">
        {branch.labels.map((label) => (
          <li key={label} data-sri-label>
            {label}
          </li>
        ))}
      </ul>
      <p className="sherivs-map-microcopy" data-sri-label>
        {branch.microcopy}
      </p>
      {branch.boundary ? (
        <p className="sherivs-map-boundary" data-sri-label>
          {branch.boundary}
        </p>
      ) : null}
      {traced ? (
        <p className="sherivs-map-traced">
          <span className="sherivs-map-flag">Traced path.</span> {traced.body}
        </p>
      ) : null}
      {others.map((path) => (
        <p key={path.id} className="sherivs-map-traced">
          <span className="sherivs-map-flag">Also crosses.</span> {path.body}
        </p>
      ))}
    </>
  );
}

function Branch({
  branch,
  open,
  related,
  onToggle,
}: {
  branch: SchoolRealityBranch;
  open: boolean;
  related: boolean;
  onToggle: (id: string) => void;
}) {
  const state = open ? "selected" : related ? "related" : "idle";

  return (
    <div className="sherivs-map-slot" data-branch={branch.id} data-side={branch.side}>
      <h3 className="sherivs-map-heading">
        <button
          type="button"
          id={buttonId(branch.id)}
          className="sherivs-map-button"
          data-side={branch.side}
          data-state={state}
          data-branch={branch.id}
          aria-expanded={open}
          aria-controls={panelId(branch.id)}
          onClick={() => onToggle(branch.id)}
        >
          <span className="sherivs-map-label">
            <span className="sherivs-map-index" data-sri-label>
              {branch.index}
            </span>
            <span className="sherivs-map-branch-name" data-sri-label>
              {branch.heading}
            </span>
          </span>
          <ChevronDown size={16} aria-hidden="true" className="sherivs-disclosure-icon" />
        </button>
      </h3>
      <div
        id={panelId(branch.id)}
        role="region"
        aria-labelledby={buttonId(branch.id)}
        hidden={!open}
        className="sherivs-map-panel"
      >
        {open ? <BranchDetail branch={branch} /> : null}
      </div>
    </div>
  );
}
