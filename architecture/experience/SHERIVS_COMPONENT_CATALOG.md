# Sherivs Component Catalog

**Version-target:** ACTIVE-V1

## Brand

| Component | Path | Status |
|---|---|---|
| Symbol + wordmark | `components/sherivs-public/brand.tsx` | Implemented |
| Favicon / PWA icons | `public/icons/*` | Existing assets; theme-color updated |
| Animated logo | — | Not implemented (motion reserved for state) |

## Navigation

| Component | Path | Status |
|---|---|---|
| Public header / mega-lite / mobile sheet | `sherivs-public/shell.tsx` | Implemented |
| Public footer | `sherivs-public/shell.tsx` | Implemented |
| App sidebar | `portal-sidebar.tsx` + nav registry | Existing, capability-driven |
| App header actions | `shell/shell-header-actions.tsx` | Search, Jarvis, theme, bell, profile |
| Bottom nav | `mobile-bottom-nav.tsx` | Existing, runtime-declared |
| Command palette | `command-center/command-palette.tsx` | Existing; authorization-bound |

## Content / product / system

Public interior pages use `SherivsInteriorPage` + typed `PUBLIC_PAGES`.  
Empty resources use `SherivsEmptyResource` (guides, case studies, platform blog).  
System states: loading skeletons (`portal-shell`), offline banner, 404/error in `__root`, unlinked account gate, health `/status`.

## Not yet first-class (documented, not faked)

Proprietary chart language, network relationship canvas, passkey/MFA forms, social share sheets, careers listing.

See `SHERIVS_EXPERIENCE_STATUS.md` for the surface inventory.
