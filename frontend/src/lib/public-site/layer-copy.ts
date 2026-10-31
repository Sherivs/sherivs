
export const LAYER_PAGES: Record<
  string,
  { path: string; eyebrow: string; title: string; lead: string; extra: readonly string[] }
> = {
  architecture: {
    path: "/product/architecture",
    eyebrow: "Architecture",
    title: "The Sherivs platform architecture",
    lead: "Eight layers, from identity to assurance. Each layer is labelled available, in development, planned, or long-term from repository evidence — not from marketing ambition.",
    extra: [
      "Public navigation never links the internal engineering view at /platform. That route stays session-gated.",
      "The first installed runtime on this architecture is Scholar. Removing it would not redefine the platform.",
    ],
  },
  "ai-workforce": {
    path: "/product/ai-workforce",
    eyebrow: "AI workforce",
    title: "Coordinated workers, not unbounded autonomy",
    lead: "AI workers in Sherivs are designed as identities with owners, permissions, bounded tasks, execution tracking, and human oversight.",
    extra: [
      "Do not expect unlimited autonomous execution. Some worker surfaces still require configured model credentials and are labelled in development.",
      "Workers must not enlarge their own permissions or deploy themselves.",
    ],
  },
  "digital-twins": {
    path: "/product/digital-twins",
    eyebrow: "Digital twins",
    title: "Twins that remember, relate, and react",
    lead: "A Sherivs twin is a governed digital model: identity, state, relationships, and events, with computation on change or on a schedule.",
    extra: [
      "Administrative twin surfaces exist in the application. A complete twin runtime is in development.",
      "Device and IoT twins are outside the current public product envelope.",
    ],
  },
  "institutional-computing": {
    path: "/product/institutional-computing",
    eyebrow: "Institutional computing",
    title: "A shared computer for the institution",
    lead: "Institutional computing is the environment where people, records, agents, and applications share identity and policy instead of reconstructing them in every tool.",
    extra: [
      "Today this is experienced primarily through organization workspaces and Sherivs Scholar.",
      "Additional industry runtimes will consume the same environment; they are not generally selectable yet.",
    ],
  },
  intelligence: {
    path: "/product/intelligence",
    eyebrow: "Intelligence infrastructure",
    title: "Grounded intelligence, routed with care",
    lead: "Sherivs intends model access to flow through a governed gateway so prompts, cost, and safety are not scattered. Canonical records stay separate from derived answers.",
    extra: [
      "An internal AI gateway exists. This is not a public model marketplace and not a certified intelligence product.",
      "AI output is untrusted by default until a person or policy accepts it.",
    ],
  },
};
