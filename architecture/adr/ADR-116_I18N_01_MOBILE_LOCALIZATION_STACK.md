# ADR-116: I18N-01 Mobile Localization Stack (I18N-01)

| Field                      | Value                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (pending reviewer approval in draft PR for issue #492)                                                                               |
| Date                       | 2026-11-24                                                                                                                                    |
| Author                     | copilot-swe-agent[bot]                                                                                                                        |
| Mission                    | I18N-01 (mobile localization scaffolding and `(school)` extraction)                                                                           |
| Version target             | V1 organizational capability envelope                                                                                                         |
| Cites                      | AGENTS.md §22-§23 repository discovery and workflow law; `mobile/app/(school)/*.tsx`; `mobile/src/i18n/*`; `tests/unit/mobile-i18n-*.test.ts` |
| Minimal ownership artifact | This ADR only — decision artifact                                                                                                             |

## Context

The mobile Scholar experience had no dedicated localization layer. `(school)` screens contained hard-coded user-visible strings, and there was no explicit fallback rule for unknown locales or missing keys.

## Options

### Option 1 — Keep hard-coded strings (rejected)

Keep all copy inside JSX and defer localization work.

- **Consequences:** No translation-ready architecture, no consistent fallback behavior, and repeated string drift across screens.

### Option 2 — Add a maintained i18n stack with English fallback and extract `(school)` strings (ruled)

Introduce `expo-localization` plus `i18next` and `react-i18next`, scaffold locale dictionaries, default to English, and extract user-visible strings in `(school)` screens.

- **Consequences:** Adds a small runtime dependency set and dictionary maintenance duty, but gives deterministic fallback behavior and a clear path for reviewed future translations.

## Recommendation (decision)

**Adopt Option 2.** Mobile uses a maintained i18n stack rooted at `mobile/src/i18n/`, with `en` as the default locale, fallback to `en` for unknown locales, and fallback to `en` when a supported locale misses a key. This mission extracts owned `(school)` user-visible strings to `mobile/src/i18n/locales/en.json` and keeps non-English locale files scaffold-only (`{}`) until reviewed translations are approved.

## Consequences (summary)

- **Positive:** Shared translation API, deterministic fallback behavior, and immediate extraction coverage for `(school)` screens.
- **Negative / obligations:** Locale dictionary must stay in sync with new copy; non-English release text remains blocked pending review.
- **For this program:** Keeps BRAND-01 ownership boundaries intact by leaving `mobile/app/(app)/**` and branding copy in `mobile/app/sign-in.tsx` untouched.

## Golden Questions

- **WHO?** I18N-01 implementation owner for mobile localization infrastructure and `(school)` extraction.
- **WHAT?** Introduce mobile i18n stack with safe English fallback defaults.
- **WHERE?** `mobile/src/i18n/`, `mobile/app/_layout.tsx`, and `mobile/app/(school)/**`.
- **WHY?** To remove hard-coded `(school)` strings and enforce fallback correctness.
- **UNDER WHICH POLICY?** AGENTS.md workflow/security governance and V1 execution boundary.

## UNKNOWNs

- Reviewed Hausa/Yoruba/Igbo/French release translations are deferred and require explicit content review.
- Future missions may extend extraction to additional mobile surfaces outside `(school)` ownership boundaries.
