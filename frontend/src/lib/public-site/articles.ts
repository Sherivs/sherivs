import { POSITIONING_STATEMENT } from "@/lib/public-site/company";

export const ARTICLE_CATEGORIES = [
  "AI and Intelligence Infrastructure",
  "AI Agents and Autonomous Work",
  "Digital Twins",
  "Institutional Computing",
  "Architecture and Engineering",
  "Security and Governance",
  "Product Updates",
  "Industry Perspectives",
] as const;

export type ArticleCategory = (typeof ARTICLE_CATEGORIES)[number];

export interface PublicArticle {
  slug: string;
  title: string;
  summary: string;
  author: { name: string; role: string };
  publishedAt: string;
  updatedAt: string;
  category: ArticleCategory;
  tags: readonly string[];
  seoTitle: string;
  seoDescription: string;
  relatedSlugs: readonly string[];
  published: boolean;
  sections: readonly { heading?: string; paragraphs: readonly string[] }[];
}

export const PUBLIC_ARTICLES: readonly PublicArticle[] = [
  {
    slug: "what-is-institutional-computing",
    title: "What is institutional computing?",
    summary:
      "Institutional computing is a shared, governed environment where an organization's people, records, agents, and twins can operate together — instead of across disconnected tools.",
    author: { name: "Sherivs", role: "Editorial" },
    publishedAt: "2026-10-26",
    updatedAt: "2026-10-26",
    category: "Institutional Computing",
    tags: ["platform", "governance", "organizations"],
    seoTitle: "What is institutional computing?",
    seoDescription:
      "A clear definition of institutional computing: shared identity, governed state, and coordinated work for organizations.",
    relatedSlugs: [
      "connected-institutional-intelligence",
      "permissions-and-verifiable-outcomes",
    ],
    published: true,
    sections: [
      {
        paragraphs: [
          "Most organizations already compute. They just do it in fragments: identity in one product, records in another, automation in a third, and a chatbot that cannot see any of them safely.",
          "Institutional computing is the idea that an institution — a school, a company, a research group — deserves a single computing environment that understands who is acting, what is true, what is allowed, and what happened.",
        ],
      },
      {
        heading: "Not a dashboard, and not a chatbot",
        paragraphs: [
          "A dashboard observes. A chatbot replies. An institutional computer holds state. It knows which people belong to which organization, which records are canonical, which agents may act, and which actions require a person to confirm.",
          "Sherivs uses this framing for the platform itself. Scholar, the education runtime, is one way that environment is experienced. It is not the definition of the company.",
        ],
      },
      {
        heading: "What has to be true",
        paragraphs: [
          "Identity is explicit. Tenant boundaries are real. Intelligence is allowed to propose, not to silently overwrite verified records. Those constraints are why institutional computing is slower to hype and more useful in production.",
        ],
      },
    ],
  },
  {
    slug: "from-assistants-to-ai-workforces",
    title: "From AI assistants to coordinated AI workforces",
    summary:
      "A single assistant in a side panel cannot run an institution. Coordinated workers need identity, permissions, bounded tasks, and oversight.",
    author: { name: "Sherivs", role: "Editorial" },
    publishedAt: "2026-10-26",
    updatedAt: "2026-10-26",
    category: "AI Agents and Autonomous Work",
    tags: ["agents", "permissions", "oversight"],
    seoTitle: "From AI assistants to coordinated AI workforces",
    seoDescription:
      "Why Sherivs treats AI workers as governed identities rather than a single unbounded assistant.",
    relatedSlugs: [
      "permissions-and-verifiable-outcomes",
      "scalable-ai-workflows",
    ],
    published: true,
    sections: [
      {
        paragraphs: [
          "Assistants are good at drafting. Institutions need work to be owned, permissioned, and checked. That is a different design.",
          "A workforce of AI workers — operations, support, research, finance analysis — only makes sense if each worker is a first-class identity with a human owner and a scope it cannot enlarge.",
        ],
      },
      {
        heading: "Bounded tasks, not ambient authority",
        paragraphs: [
          "The useful unit of work is a task with an objective, a permission set, and a completion record. Continuous ambient agents that “just handle it” hide who acted and under which policy.",
          "Sherivs does not promise unlimited autonomous execution. Where worker features exist in the product, they depend on configuration and remain untrusted by default.",
        ],
      },
    ],
  },
  {
    slug: "digital-twins-state-and-events",
    title: "How digital twins maintain identity, state, and relationships",
    summary:
      "A twin that is only a 3D model is decoration. A useful twin remembers state, relationships, and events, then computes when those events occur.",
    author: { name: "Sherivs", role: "Editorial" },
    publishedAt: "2026-10-26",
    updatedAt: "2026-10-26",
    category: "Digital Twins",
    tags: ["twins", "events", "state"],
    seoTitle: "Why digital twins need persistent state",
    seoDescription:
      "Digital twins in Sherivs are governed models of identity, state, relationships, and events — not screenshots of a 3D scene.",
    relatedSlugs: [
      "what-is-institutional-computing",
      "connected-institutional-intelligence",
    ],
    published: true,
    sections: [
      {
        paragraphs: [
          "A digital twin is often sold as a picture of a building or a device. Pictures do not decide who may change a record, and they do not remember what happened last Tuesday.",
          "For an institution, a twin has to be a durable object: identity, current state, relationships to people and other twins, and a history of events. Compute should run when those events happen, or on a schedule the organization authorized — not as a permanently spinning worker for every object.",
        ],
      },
      {
        heading: "Honesty about availability",
        paragraphs: [
          "Sherivs treats twins as part of the long-term architecture. Administrative surfaces exist. A complete twin runtime, including device and IoT twins, is not claimed as a generally available product in the current execution profile.",
        ],
      },
    ],
  },
  {
    slug: "permissions-and-verifiable-outcomes",
    title: "Designing AI systems with explicit permissions and verifiable outcomes",
    summary:
      "If an AI system cannot say who authorized an action, the action does not belong in an institution.",
    author: { name: "Sherivs", role: "Editorial" },
    publishedAt: "2026-10-26",
    updatedAt: "2026-10-26",
    category: "Security and Governance",
    tags: ["authorization", "audit", "ai"],
    seoTitle: "AI permissions and verifiable outcomes",
    seoDescription:
      "How Sherivs thinks about identity, policy, and evidence when AI participates in organizational work.",
    relatedSlugs: [
      "from-assistants-to-ai-workforces",
      "what-is-institutional-computing",
    ],
    published: true,
    sections: [
      {
        paragraphs: [
          "Authorization is not a prompt. It is a decision from identity, tenant, role, relationship, resource, action, policy, and risk.",
          "When AI participates, the same decision still has to be made. A model can draft a message or suggest a schedule. It should not become an administrator because the interface made that easy.",
        ],
      },
      {
        heading: "Evidence over confidence",
        paragraphs: [
          "A verifiable outcome records what happened, who initiated it, and which policy applied. Confidence scores are not evidence. Sherivs separates canonical records from derived intelligence so a fluent answer cannot quietly replace a ledger row.",
        ],
      },
    ],
  },
  {
    slug: "scalable-ai-workflows",
    title: "How event-driven computing reduces unnecessary persistent workloads",
    summary:
      "Always-on workers are an expensive default. Most institutional work is event-driven or scheduled.",
    author: { name: "Sherivs", role: "Editorial" },
    publishedAt: "2026-10-26",
    updatedAt: "2026-10-26",
    category: "Architecture and Engineering",
    tags: ["workflows", "cost", "agents"],
    seoTitle: "Scalable AI workflows without always-on workers",
    seoDescription:
      "Why Sherivs prefers bounded, event-driven or scheduled work over permanently running every AI worker.",
    relatedSlugs: [
      "from-assistants-to-ai-workforces",
      "digital-twins-state-and-events",
    ],
    published: true,
    sections: [
      {
        paragraphs: [
          "If every agent is a long-running process, cost and blast radius grow with headcount. Institutions do not need that. They need work to start when an authorized event occurs, run inside a budget, and stop.",
          "Event-driven and scheduled computation also make oversight possible: you can see which run happened, what it was allowed to touch, and whether a person had to approve the result.",
        ],
      },
      {
        heading: "What we do not claim",
        paragraphs: [
          "Dynamic wake-and-sleep of every worker at global scale is still an engineering problem in progress. This article is a design position, not a benchmark and not a product launch.",
        ],
      },
    ],
  },
  {
    slug: "connected-institutional-intelligence",
    title: "How Sherivs approaches connected institutional intelligence",
    summary:
      "Intelligence becomes useful when it is connected to authorized reality — and dangerous when it is not.",
    author: { name: "Sherivs", role: "Editorial" },
    publishedAt: "2026-10-26",
    updatedAt: "2026-10-26",
    category: "AI and Intelligence Infrastructure",
    tags: ["intelligence", "platform", "vision"],
    seoTitle: "Connected institutional intelligence",
    seoDescription:
      "Sherivs' approach to intelligence that is grounded in organizational reality, permissions, and verification.",
    relatedSlugs: [
      "what-is-institutional-computing",
      "permissions-and-verifiable-outcomes",
      "governed-intelligence-for-institutions",
    ],
    published: true,
    sections: [
      {
        paragraphs: [
          POSITIONING_STATEMENT,
          "Connected intelligence is not “one model that knows everything.” It is the ability to ask a question against the records, people, and policies an organization has already authorized, then to act only within that same boundary.",
          "Sherivs is built toward that architecture: identity and governance, institutional computing, agent orchestration, twins, model routing, execution, data, and assurance. Some of those layers are usable today in Scholar. Others are in development or long-term.",
        ],
      },
      {
        heading: "A public standard for claims",
        paragraphs: [
          "This website will not invent customers, certifications, or performance numbers to make the story feel finished. The useful question is always: who is acting, on what, under which policy, and how would we verify the result?",
        ],
      },
    ],
  },
  {
    slug: "governed-intelligence-for-institutions",
    title: "Building governed intelligence for institutions",
    summary:
      "Intelligence that cannot be permissioned, recorded, and refused is not institutional infrastructure.",
    author: { name: "Sherivs", role: "Editorial" },
    publishedAt: "2026-10-26",
    updatedAt: "2026-10-26",
    category: "Industry Perspectives",
    tags: ["governance", "intelligence", "institutions"],
    seoTitle: "Building governed intelligence for institutions",
    seoDescription:
      "Why institutions need intelligence that sits inside identity, policy, and verification — not beside them.",
    relatedSlugs: [
      "connected-institutional-intelligence",
      "permissions-and-verifiable-outcomes",
    ],
    published: true,
    sections: [
      {
        paragraphs: [
          "Institutions already have intelligence: people, procedures, and records. Adding a model does not automatically make that intelligence safer. It can make it faster at being wrong, or faster at acting outside policy.",
          "Governed intelligence means a model may propose, a policy may allow or deny, and a record may change only when the action is attributable. Sherivs uses that order on purpose. It is slower to hype and more useful when the work is real.",
        ],
      },
      {
        heading: "What this is not",
        paragraphs: [
          "This is not a claim that every Sherivs surface already routes every prompt through a finished public gateway with published SLAs. An internal AI gateway exists. A certified intelligence product does not. The design position is still the right one to hold while those layers mature.",
        ],
      },
    ],
  },
  {
    slug: "agent-versus-engineering-workforce",
    title: "The difference between an AI agent and an autonomous engineering workforce",
    summary:
      "An agent completes a task. A workforce is a set of identities, permissions, and oversight. Treating them as the same thing is how systems lose control.",
    author: { name: "Sherivs", role: "Editorial" },
    publishedAt: "2026-10-26",
    updatedAt: "2026-10-26",
    category: "AI Agents and Autonomous Work",
    tags: ["agents", "workforce", "oversight"],
    seoTitle: "AI agent versus autonomous engineering workforce",
    seoDescription:
      "Why Sherivs distinguishes a single agent from a governed workforce of workers with owners and limits.",
    relatedSlugs: [
      "from-assistants-to-ai-workforces",
      "scalable-ai-workflows",
    ],
    published: true,
    sections: [
      {
        paragraphs: [
          "An AI agent is often a loop: read, think, act. That loop is useful for a bounded job. It is not an organization. An engineering workforce — even a small one — needs names, owners, scopes, budgets, and a way for a person to stop the work.",
          "Sherivs uses “AI workforce” for that second idea. Workers are identities. They do not enlarge their own permissions. They do not deploy themselves. Unlimited autonomous execution is not the product.",
        ],
      },
      {
        heading: "Availability",
        paragraphs: [
          "Some worker surfaces in the application still require configured model credentials and are labelled in development. This article describes the design, not a promise that every institution already runs a full autonomous workforce.",
        ],
      },
    ],
  },
];

export function publishedArticles() {
  return PUBLIC_ARTICLES.filter((article) => article.published);
}

export function articleBySlug(slug: string) {
  return publishedArticles().find((article) => article.slug === slug);
}

export function articlesByCategory(category: ArticleCategory) {
  return publishedArticles().filter((article) => article.category === category);
}

export function categoryToSlug(category: string) {
  return category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function categoryFromSlug(slug: string) {
  return ARTICLE_CATEGORIES.find((category) => categoryToSlug(category) === slug) ?? null;
}
