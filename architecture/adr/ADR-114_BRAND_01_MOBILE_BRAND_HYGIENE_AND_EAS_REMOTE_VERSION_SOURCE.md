# ADR-114: BRAND-01 Mobile Brand Hygiene and EAS Remote Version Source

| Field | Value |
|---|---|
| Status | PROPOSED |
| Date | 2026-11-24 |
| Author | copilot-swe-agent[bot] |
| Mission | BRAND-01 (mobile hygiene) |
| Version target | V1 organizational mobile app |
| Cites | mobile/app.json; mobile/package.json; mobile/README.md; mobile/src/lib/native-passkey.ts; tests/unit/mobile-passkey.test.ts; tests/unit/mobile-store-config.test.ts; AGENTS.md §22, §23, §30 |

## Context

User-facing mobile copy still mixed product naming ("Sherivs" vs "Scholar"), local iOS/Android build counters remained in `mobile/app.json` despite EAS remote app-version source, splash background was not aligned with the Scholar visual baseline, and a stale local asset-generation script remained documented and runnable.

## Decision

Adopt **Scholar** as the user-facing product name across the scoped mobile screens/components and user-visible mobile error copy, while retaining Sherivs for company attribution text (for example, "Scholar by Sherivs"). Remove local `ios.buildNumber` and `android.versionCode` from `mobile/app.json` so EAS remote versioning remains the single source of truth. Set the Expo splash plugin `backgroundColor` to `#0B1F3A`, retain Android adaptive icon background as `#FFFFFF`, delete the obsolete local asset generator script and its npm entry, and align the targeted tests and docs with those exact changes.

## Consequences

- **Positive:** Product branding is consistent for users, release version source is unambiguous, and obsolete local script usage is removed.
- **Obligations:** Keep company attribution text intact where legal/brand ownership needs it, preserve untouched app-link/update keys owned by parallel missions, and keep verification focused on changed mobile surfaces and provenance/security checks.

## Golden Questions

- **WHO?** MOBILE/BRAND-01 mission owns this scoped hygiene update.
- **WHAT?** User-facing brand cleanup + remote-version-source hygiene with no ownership overlap edits.
- **WHERE?** Mobile app copy/config/docs/tests listed in Cites and this ADR file.
- **WHY?** Resolve inconsistent product naming and stale local version/asset workflow.
- **UNDER WHICH POLICY?** AGENTS.md governance hierarchy, repository discovery law, and secret-safety constraints.

## UNKNOWNs

- No unresolved technical UNKNOWNs inside this mission scope; app links, OTA update wiring, and i18n extraction stay with their parallel missions.
