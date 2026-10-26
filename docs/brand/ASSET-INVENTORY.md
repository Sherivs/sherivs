# Sherivs brand asset inventory

Document: SHERIVS-ENTERPRISE-WEBSITE-BRAND-CONTENT-001  
Updated: 2026-10-26. Marks were not redrawn. Wordmark and ThinkTech files are owner-supplied.

## Source files in the repository

| File | Use |
|------|-----|
| `docs/brand/sherivs-logo-source.png` | Master ribbon S on a light field (byte-identical to the owner-supplied S in this mission). |
| `docs/brand/sherivs-wordmark-source.png` | Owner-supplied lockup (S + “Sherivs”). Transparent field; letterforms are dark navy. |
| `docs/brand/thinktech-logo-source.jpg` | Owner-supplied ThinkTech plate (vertical JPEG with black letterboxing). |
| `public/brand/sherivs-logo-512.png` | Compact S on a transparent field for dark surfaces. |
| `public/brand/sherivs-mark-64.png` | Compact S. Favicon / tight UI. |
| `public/brand/sherivs-mark-128.png` | Compact S. |
| `public/brand/sherivs-mark-256.png` | Compact S, header and 2x. |
| `public/brand/sherivs-wordmark.png` | Cropped lockup for **light** surfaces only. |
| `public/partners/thinktech.png` | Cropped ThinkTech lockup on its white plate. Not redrawn. |
| `public/favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png` | Browser icon (standalone S). |
| `public/apple-touch-icon.png`, `public/icons/*.png` | PWA / touch icons (standalone S). |
| `public/og-image.png` | Social-sharing image (S + live white word on navy; official lockup is too dark for that field). Tagline is the owner positioning line. |
| `frontend/src/components/brand/sherivs-logo.tsx` | `<SherivsLogo>` / `<SherivsMark>` for dark chrome; `<SherivsLockup>` for light surfaces. |

## Variant selection

- **Dark public site (primary):** compact S (`sherivs-mark-*`) plus live white “Sherivs” text. The official lockup’s navy letterforms fail contrast on midnight navy, so it is not used in the header or footer.
- **Light surfaces (404):** `<SherivsLockup>` — the owner-supplied wordmark, unaltered except crop-to-content.
- **Favicon / app icon:** standalone S.
- Do not stretch, recolor, invert, or replace the S with a geometric placeholder.

## Color sampling (quantized from `sherivs-logo-source.png`)

| Region | Sampled family | Token used |
|--------|----------------|------------|
| Upper ribbon (cyan) | `#14A4FC` … `#1CB4FC` | `--sherivs-cyan: #14A8FC` |
| Mid fold (royal blue) | `#1048F8` … `#184EFD` | `--sherivs-blue: #1848FD` |
| Lower ribbon (violet) | `#8050F8` … `#9058F8` | `--sherivs-violet: #8254F6` |
| Deep inner fold | near `#04103C` | `--sherivs-navy: #10182B` |
| Page field (design) | owner direction | `--sherivs-obsidian: #080B18` |
| Text | owner direction | `--sherivs-white: #F7F9FF`, `--sherivs-muted: #AAB4C8` |
| Wordmark letters | `#020C28` family | Light-surface lockup only |

Owner-proposed `#246BFD` / `#29C5F6` were shifted toward sampled logo pixels so the site matches the mark, not a generic SaaS blue.

## ThinkTech

Public partner card uses `public/partners/thinktech.png` on a white plate so the black lockup remains readable on the dark site. The tagline spelling on the supplied artwork is unchanged. Owner-supplied collaboration copy (development, infrastructure, consulting, integration, marketing) is published on `/company/partners`.

## Typography

Existing project fonts, two families:

- Inter — body and interface.
- Plus Jakarta Sans — display headings (`--font-display`).

Space Grotesk was not added (would be a third family).
