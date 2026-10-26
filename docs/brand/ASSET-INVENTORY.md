# Sherivs brand asset inventory

Document: SHERIVS-ENTERPRISE-WEBSITE-BRAND-CONTENT-001  
Sampled: 2026-10-26 from repository files. The mark was not redrawn.

## Source files in the repository

| File | Use |
|------|-----|
| `docs/brand/sherivs-logo-source.png` | Master ribbon S on a light field. Best reference for sampling. |
| `public/brand/sherivs-logo-512.png` | Same mark on a dark field. Compact/dark-surface reference. |
| `public/brand/sherivs-mark-64.png` | Compact S. Favicon / tight UI. |
| `public/brand/sherivs-mark-128.png` | Compact S. |
| `public/brand/sherivs-mark-256.png` | Compact S, header and 2x. |
| `public/favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png` | Browser icon (standalone S). |
| `public/apple-touch-icon.png`, `public/icons/*.png` | PWA / touch icons (standalone S). |
| `public/og-image.png` | Social-sharing image. |
| `frontend/src/components/brand/sherivs-logo.tsx` | Official component: raster mark + live-text wordmark “Sherivs”. |

No separate vector wordmark file is in the repository. Primary brand placement uses `<SherivsLogo>` (mark + typeset wordmark). Compact applications use `<SherivsMark>` or the favicon set.

ThinkTech: no approved logo file is in the repository. The partner card is text-only until an owner-approved asset is added.

## Variant selection

- **Dark public site (primary):** `sherivs-mark-*` / `sherivs-logo-512` against midnight navy. The ribbon is self-luminous; it does not need a white plate.
- **Light surfaces (404 and similar):** the same mark; the source file on white confirms contrast.
- Do not stretch, recolor, or replace the S with a geometric placeholder.

## Color sampling (quantized from `sherivs-logo-source.png`)

| Region | Sampled family | Token used |
|--------|----------------|------------|
| Upper ribbon (cyan) | `#14A4FC` … `#1CB4FC` | `--sherivs-cyan: #14A8FC` |
| Mid fold (royal blue) | `#1048F8` … `#184EFD` | `--sherivs-blue: #1848FD` |
| Lower ribbon (violet) | `#8050F8` … `#9058F8` | `--sherivs-violet: #8254F6` |
| Deep inner fold | near `#04103C` | `--sherivs-navy: #10182B` |
| Page field (design) | owner direction | `--sherivs-obsidian: #080B18` |
| Text | owner direction | `--sherivs-white: #F7F9FF`, `--sherivs-muted: #AAB4C8` |

Owner-proposed `#246BFD` / `#29C5F6` were shifted toward sampled logo pixels so the site matches the mark, not a generic SaaS blue.

## Typography

Existing project fonts, two families:

- Inter — body and interface.
- Plus Jakarta Sans — display headings (`--font-display`).

Space Grotesk was not added (would be a third family).
