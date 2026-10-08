/**
 * Sherivs public content — solution segments.
 *
 * A segment exists only when the platform serves it today. Sector runtimes are read from
 * the installed-runtime registry so the public site never claims a runtime that is not
 * installed.
 */
import { INSTALLED_RUNTIMES } from "@/lib/runtime/installed-runtimes";

export interface SolutionSegment {
  slug: string;
  name: string;
  tagline: string;
  summary: string;
  /** What an organization in this segment gets, in order of first use. */
  outcomes: readonly { title: string; detail: string }[];
  /** Platform layers this segment leans on most (slugs from PLATFORM_LAYERS). */
  layers: readonly string[];
  /** Installed runtime that specializes the platform for this segment, if any. */
  runtimeId?: string;
}

const educationRuntime = INSTALLED_RUNTIMES.find((runtime) => runtime.id === "runtime:scholar");

export const SOLUTION_SEGMENTS: readonly SolutionSegment[] = [
  {
    slug: "organizations",
    name: "Organizations",
    tagline: "One governed layer for any institution.",
    summary:
      "The platform core — identity and tenancy, roles and policies, workspace composition, governed AI and audit — is domain-neutral by construction, checked on every change. Sector runtimes add their own vocabulary on top.",
    outcomes: [
      {
        title: "Identity and tenancy first",
        detail:
          "Your organization becomes a tenant with its own members, roles and policies, isolated in the database from every other tenant.",
      },
      {
        title: "Workspaces that fit",
        detail:
          "Each person's workspace is projected from their role and permissions. Nobody is shown modules they cannot use.",
      },
      {
        title: "Governed AI from day one",
        detail:
          "Assistants work through the platform's AI gateway, inside each person's authorization, with every call logged.",
      },
    ],
    layers: ["reality", "governance", "intelligence"],
  },
  ...(educationRuntime
    ? [
        {
          slug: "education",
          name: "Education",
          tagline: `${educationRuntime.brandName} — the education runtime.`,
          summary: educationRuntime.summary,
          outcomes: [
            {
              title: "The institution, modelled",
              detail:
                "Classes, staff, learners, guardians, timetables and facilities are registered on the platform's reality model, not in a separate silo.",
            },
            {
              title: "Every role, its own workspace",
              detail:
                "Administrators, teachers, finance staff, guardians, learners and drivers each get a workspace projected from their permissions.",
            },
            {
              title: "Payments and communication",
              detail:
                "Fees are reconciled from signature-verified payment events, and announcements reach families through governed channels.",
            },
          ],
          layers: ["reality", "intelligence", "integrations"],
          runtimeId: educationRuntime.id,
        } satisfies SolutionSegment,
      ]
    : []),
];

export function findSolutionSegment(slug: string): SolutionSegment | undefined {
  return SOLUTION_SEGMENTS.find((segment) => segment.slug === slug);
}
