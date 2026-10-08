/**
 * Published Sherivs public content (reviewed, factual). Every entry is validated by
 * `parseContent` at module load, so a malformed record fails the build/test, not a visitor.
 *
 * Rules: no invented customers, metrics, quotes, logos or live-activity claims.
 */
import { parseContent, type ContentItem } from "./content";

const author = { name: "Sherivs" } as const;

export const PUBLISHED_CONTENT: readonly ContentItem[] = parseContent([
  {
    slug: "core-concepts",
    section: "docs",
    title: "Core concepts: reality, intelligence, action, evidence",
    description:
      "The four planes Sherivs organizes work around, and why verified truth is kept separate from inference.",
    author,
    status: "published",
    publishedAt: "2026-10-08",
    updatedAt: "2026-10-08",
    tags: ["concepts", "architecture"],
    categories: ["Concepts"],
    body: [
      { type: "p", text: "Sherivs is built around four planes. Every surface in the product sits on one of them, and moves information from one to the next only through a defined step." },
      { type: "h2", text: "Reality" },
      { type: "p", text: "Reality is verified system truth: records, transactions, state and history. It is the only plane that is allowed to be called fact." },
      { type: "h2", text: "Intelligence" },
      { type: "p", text: "Intelligence is derived understanding: summaries, predictions and recommendations. It is always labelled as derived, and it can never overwrite reality without validation." },
      { type: "h2", text: "Action" },
      { type: "p", text: "Action is something being done. It happens only through authorized, gated steps, under a named authority." },
      { type: "h2", text: "Evidence" },
      { type: "p", text: "Evidence is what proves an action happened and what it changed. It is captured, attributed and independently verified — a worker saying it succeeded is not evidence." },
      { type: "callout", tone: "note", text: "The same four words describe the product's layout: reality is where you start, evidence is where you can always end up." },
    ],
  },
  {
    slug: "reading-ai-output",
    section: "docs",
    title: "Reading AI output in Sherivs",
    description:
      "How Sherivs labels observations, inferences, recommendations, actions, evidence and verification so you can tell them apart.",
    author,
    status: "published",
    publishedAt: "2026-10-08",
    updatedAt: "2026-10-08",
    tags: ["ai", "trust", "interface"],
    categories: ["Concepts"],
    body: [
      { type: "p", text: "AI output is untrusted by default. To make that visible, Sherivs marks every statement with the kind of thing it is. The label is text with an icon — it never relies on colour alone." },
      { type: "ul", items: [
        "Observation — something that was read from a record or event.",
        "Inference — a conclusion derived from observations; it can be wrong.",
        "Recommendation — a suggested next step; it does nothing until someone approves it.",
        "Action — a step that was, or is being, carried out under a named authority.",
        "Evidence — captured proof of what happened, with its source and time.",
        "Verification — an independent check of an outcome, with its result.",
      ] },
      { type: "h2", text: "Confidence" },
      { type: "p", text: "Where a confidence value exists it is shown as a number with its basis. If no confidence was assessed, the interface says so rather than showing a default." },
      { type: "h2", text: "Processing indicators" },
      { type: "p", text: "A moving indicator appears only while a request is genuinely in progress. Sherivs does not animate to imply that work is happening when it is not." },
    ],
  },
  {
    slug: "organization-branding",
    section: "docs",
    title: "Organization branding and accessibility",
    description:
      "How an organization's brand colour is applied to Sherivs without reducing legibility.",
    author,
    status: "published",
    publishedAt: "2026-10-08",
    updatedAt: "2026-10-08",
    tags: ["branding", "accessibility", "theming"],
    categories: ["Administration"],
    body: [
      { type: "p", text: "An organization can supply a primary and secondary brand colour. Sherivs treats these as input to a controlled brand layer, not as raw CSS." },
      { type: "ul", items: [
        "Only #rgb and #rrggbb values are accepted; anything else is ignored.",
        "For the light and dark themes separately, the colour is checked against the interface's surfaces for a contrast ratio of at least 4.5:1.",
        "If a colour is too light or too dark to read, it is shifted toward readable — the original is preserved for logos and marks.",
        "The text colour placed on top of a brand-coloured button is chosen automatically for legibility.",
      ] },
      { type: "callout", tone: "note", text: "Brand colour changes accents and actions. It cannot change layout, structure, typography or focus indicators." },
    ],
  },
  {
    slug: "sherivs-experience-system",
    section: "changelog",
    title: "The Sherivs experience system",
    description:
      "A unified design system, a new public website, and a controlled organization brand layer ship under the Sherivs name.",
    author,
    status: "published",
    publishedAt: "2026-10-08",
    updatedAt: "2026-10-08",
    tags: ["release", "design-system", "brand"],
    categories: ["Platform"],
    body: [
      { type: "p", text: "The platform now presents itself as Sherivs, with one design language across the public site and the application." },
      { type: "h2", text: "What's new" },
      { type: "ul", items: [
        "A typed design-token system (colour, type, space, radius, depth, motion, stacking) with verified WCAG contrast in light and dark themes.",
        "A new Sherivs public website: platform, solutions, security, pricing, resources and status.",
        "A controlled organization brand layer that keeps brand colours legible.",
        "Trust primitives for labelling observations, inferences, recommendations, actions, evidence and verification.",
        "Distinct, accessible states for loading, empty, error, offline, forbidden, expired and stale content.",
      ] },
      { type: "h2", text: "Compatibility" },
      { type: "p", text: "Technical identifiers — package names, database objects and API headers — keep their existing names so integrations keep working." },
    ],
  },
]);
