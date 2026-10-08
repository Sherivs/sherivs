# Sherivs Information Architecture

Version target: **V1**.

## Public narrative

The homepage is ordered, not gridded:

1. Brand — Sherivs, institutional intelligence infrastructure.
2. Category — why an organization needs a layer that can tell the truth.
3. Planes — reality, intelligence, action, evidence.
4. Capabilities — the six published platform capabilities.
5. Mission path — the execution stages the code actually runs, including denial and exhaustion.
6. Domain runtime — the installed education runtime, named as a runtime.
7. Governance — the security guarantees.
8. Begin — create an account, or read the kernel page.

Primary navigation is Platform, Solutions, Security, Pricing, Resources. Everything else is in the footer so the header stays a sentence, not a directory.

## Organization

Universal public sections: identity, about, contact.
Education sections: programs, admissions. Withheld unless `runtime:scholar` is installed.

Universal workspace candidates: overview, people, work, missions, memory, calendar, AI workforce, governance, settings. Each capability-gated item is hidden without that capability. The live sidebar still comes from the Scholar contribution catalog for education roles; the configuration function is the neutral rule those catalogs must keep satisfying.

## Internal

Executive, missions, security, and operations are separate capability keys (`internal.*`). They do not appear in the public or organization planes.

## Account

Present: sign in, sign up, forgot password, reset, settings.
Specified and not built as pages: MFA enrollment, passkeys, session list, device list, login history, data export, account deletion. Do not add empty screens for them.

## Findability

Footer repeats legal and contact. Sitemap lists registered public paths plus active tenant homepages. Canonical URLs use `https://sherivs.com`. There is no Open Graph image because no image file exists.
