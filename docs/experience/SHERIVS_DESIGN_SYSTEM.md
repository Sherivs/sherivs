# Sherivs Design System

## Materials

The public experience uses paper (`#f3efe6`), ink (`#161410`), and one brass instrument color for indexes and labels. Dark mode inverts the paper and ink. Translucency is limited to the sticky header so the page can scroll under it.

The authenticated application still uses the existing surface tokens, now set in Public Sans and Newsreader. Organization brand colors continue to override `--tenant-primary` and `--tenant-secondary`. They must not replace ink, paper, or focus treatment on the public site.

## Typography

| Role | Face | Use |
| --- | --- | --- |
| Display, hero, headings | Newsreader | Public narrative, page titles |
| Body, UI | Public Sans | Interface and prose |
| Data, code | IBM Plex Mono | Identifiers, manifest ids |

Roles and sizes are declared in `frontend/src/lib/sherivs/tokens.ts` and mirrored in `frontend/src/styles.css`.

## When to use a surface

| Use | When |
| --- | --- |
| Narrative section | The reader needs order and argument |
| Definition list | Named concepts with one sentence each |
| Numbered sequence | A process with a required order |
| Table | Comparing records that share columns, such as the kernel registry |
| List | A catalog with a stable id, such as pricing tiers |
| Card | A repeated object the person will open. Not the default for marketing |
| Drawer, dialog | A temporary decision that should not navigate away |
| Full page | A mission, a document, or a settings domain |

## Theming

Light, dark, and system are already implemented (`frontend/src/lib/theme.ts`). Organization branding is the tenant token layer. High-contrast as a separate theme is not implemented.

## Components shipped in this program

`PublicShell`, `HomeNarrative`, `EditorialPage`, `DocumentPage`, `AccountMap`, and the existing shadcn primitives under `frontend/src/components/ui/`.

The full target catalog is in `SHERIVS_COMPONENT_CATALOG.md`. Families that are not built are listed there as not built.
