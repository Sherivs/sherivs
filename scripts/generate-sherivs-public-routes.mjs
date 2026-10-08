#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(fileURLToPath(new URL("..", import.meta.url)), "frontend/src/routes/(site)");

const pages = [
  ["platform.reality.tsx", "/(site)/platform/reality", "platformReality", "Reality — Sherivs"],
  ["platform.memory.tsx", "/(site)/platform/memory", "platformMemory", "Memory — Sherivs"],
  ["platform.ai-workforce.tsx", "/(site)/platform/ai-workforce", "platformWorkforce", "AI Workforce — Sherivs"],
  ["platform.missions.tsx", "/(site)/platform/missions", "platformMissions", "Missions — Sherivs"],
  ["platform.intelligence.tsx", "/(site)/platform/intelligence", "platformIntelligence", "Intelligence — Sherivs"],
  ["platform.governance.tsx", "/(site)/platform/governance", "platformGovernance", "Governance — Sherivs"],
  ["platform.integrations.tsx", "/(site)/platform/integrations", "platformIntegrations", "Integrations — Sherivs"],
  ["solutions.tsx", "/(site)/solutions", "solutions", "Solutions — Sherivs"],
  ["solutions.organizations.tsx", "/(site)/solutions/organizations", "solutionsOrganizations", "Organizations — Sherivs"],
  ["solutions.enterprise.tsx", "/(site)/solutions/enterprise", "solutionsEnterprise", "Enterprise — Sherivs"],
  ["solutions.education.tsx", "/(site)/solutions/education", "solutionsEducation", "Education — Sherivs"],
  ["solutions.operations.tsx", "/(site)/solutions/operations", "solutionsOperations", "Operations — Sherivs"],
  ["solutions.ai-workforce.tsx", "/(site)/solutions/ai-workforce", "solutionsWorkforce", "AI Workforce — Sherivs"],
  ["security.tsx", "/(site)/security", "security", "Security — Sherivs"],
  ["enterprise.tsx", "/(site)/enterprise", "enterprise", "Enterprise — Sherivs"],
  ["about.tsx", "/(site)/about", "about", "About — Sherivs"],
  ["company.tsx", "/(site)/company", "company", "Company — Sherivs"],
  ["contact.tsx", "/(site)/contact", "contact", "Contact — Sherivs"],
  ["request-demo.tsx", "/(site)/request-demo", "requestDemo", "Request a demo — Sherivs"],
  ["legal.privacy.tsx", "/(site)/legal/privacy", "privacy", "Privacy — Sherivs"],
  ["legal.terms.tsx", "/(site)/legal/terms", "terms", "Terms — Sherivs"],
  ["legal.cookies.tsx", "/(site)/legal/cookies", "cookies", "Cookies — Sherivs"],
  ["legal.accessibility.tsx", "/(site)/legal/accessibility", "accessibility", "Accessibility — Sherivs"],
];

for (const [file, route, key, title] of pages) {
  writeFileSync(
    join(DIR, file),
    `import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("${route}")({
  component: Page,
  head: () => ({
    meta: [
      { title: "${title}" },
      { name: "description", content: PUBLIC_PAGES.${key}.lead },
      { property: "og:title", content: "${title}" },
      { property: "og:description", content: PUBLIC_PAGES.${key}.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.${key}} />;
}
`,
  );
  console.log("wrote", file);
}
