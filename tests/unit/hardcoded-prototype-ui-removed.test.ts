/**
 * Hardcoded Lovable / Scholar / console prototype UI must stay gone.
 * The public company website (#139) and the tenant website engine remain.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isRetiredApplicationHostname } from "@/lib/experience/retired-application-host";
import { resolveExperienceHost } from "@/lib/experience/experience-host";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const gone = (relative: string) => expect(existsSync(join(ROOT, relative)), relative).toBe(false);
const kept = (relative: string) => expect(existsSync(join(ROOT, relative)), relative).toBe(true);

describe("hardcoded application shells are removed", () => {
  it("deletes the authenticated school/console route tree", () => {
    gone("frontend/src/routes/_authenticated");
    gone("frontend/src/routes/_authenticated/route.tsx");
    gone("frontend/src/routes/_authenticated/admin/dashboard.tsx");
    gone("frontend/src/routes/_authenticated/internal.tsx");
    gone("frontend/src/routes/_authenticated/super-admin/route.tsx");
    gone("frontend/src/routes/_authenticated/command-centre/index.tsx");
  });

  it("deletes gov, group, head, and leftover prototype routes", () => {
    gone("frontend/src/routes/gov/index.tsx");
    gone("frontend/src/routes/group/index.tsx");
    gone("frontend/src/routes/head.tsx");
    gone("frontend/src/routes/gov-invite.tsx");
    gone("frontend/src/routes/platform.tsx");
    gone("frontend/src/routes/platform.org.tsx");
    gone("frontend/src/routes/admissions.tsx");
    gone("frontend/src/routes/ux-lab.tsx");
    gone("frontend/src/routes/marketplace.tsx");
    gone("frontend/src/routes/blog.tsx");
    gone("frontend/src/components/portal-sidebar.tsx");
    gone("frontend/src/components/portal-shell.tsx");
    gone("frontend/src/components/public/platform-home.tsx");
    gone("frontend/src/components/sds/sds.css");
    gone("frontend/src/components/shell/workspace-switcher.tsx");
  });

  it("keeps the public company website and tenant website engine", () => {
    kept("frontend/src/components/public/sherivs-home.tsx");
    kept("frontend/src/routes/(site)/route.tsx");
    kept("frontend/src/routes/(site)/about.tsx");
    kept("frontend/src/routes/(site)/request-demo.tsx");
    kept("frontend/src/lib/public-site/company.ts");
    kept("frontend/src/components/website/site-view.tsx");
    kept("frontend/src/routes/pages.$slug.tsx");
    kept("frontend/src/routes/auth.tsx");
    kept("frontend/src/components/public/application-unavailable.tsx");
    kept("frontend/src/lib/experience/retired-application-host.ts");
    kept("frontend/src/components/app-entry/app-entry-screen.tsx");
    kept("frontend/src/routes/onboarding.tsx");
  });
});

describe("retired application hosts", () => {
  it("retires console, gov, head, and group hosts — not public, tenant, or the app splash", () => {
    expect(isRetiredApplicationHostname("app.sherivs.com")).toBe(false);
    expect(isRetiredApplicationHostname("console.sherivs.com")).toBe(true);
    expect(isRetiredApplicationHostname("internal.sherivs.com")).toBe(true);
    expect(isRetiredApplicationHostname("gov.sherivs.com")).toBe(true);
    expect(isRetiredApplicationHostname("head.sherivs.com")).toBe(true);
    expect(isRetiredApplicationHostname("group.sherivs.com")).toBe(true);
    expect(isRetiredApplicationHostname("admin.sherivs.com")).toBe(true);
    expect(isRetiredApplicationHostname("app.universalschoolos.com")).toBe(false);
    expect(isRetiredApplicationHostname("console.universalschoolos.com")).toBe(true);
    expect(isRetiredApplicationHostname("borno.gov.sherivs.com")).toBe(true);
    expect(isRetiredApplicationHostname("console.unimaid.sherivs.com")).toBe(true);
    expect(isRetiredApplicationHostname("sherivs.com")).toBe(false);
    expect(isRetiredApplicationHostname("www.sherivs.com")).toBe(false);
    expect(isRetiredApplicationHostname("northwind.sherivs.com")).toBe(false);
    expect(resolveExperienceHost("northwind.sherivs.com")).toBe("tenant");
  });
});
