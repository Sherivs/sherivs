# SHERIVS-ENTERPRISE-WEBSITE-BRAND-CONTENT-001

Version-target classification: **ACTIVE-V1** (public marketing and documentation). V2/V3 remain frozen.

## 1. Repository audit

| Item | Finding |
|------|---------|
| Root / branch | `/workspace`, `cursor/sherivs-enterprise-website-brand-content-b574` from `cursor/sherivs-enterprise-public-website-b574` @ `de889364` |
| Prior work | Luminous Enterprise public site already on this stack (TanStack Start, Vite, React, Tailwind). Not migrated. |
| Logo | `docs/brand/sherivs-logo-source.png` (light), `public/brand/sherivs-logo-512.png` (dark), `public/brand/sherivs-mark-{64,128,256}.png`. Component: `SherivsLogo` / `SherivsMark`. Not redrawn. |
| Email MX | `sherivs.com` MX `mx1/mx2.privateemail.com`. Individual mailbox SMTP not proven. Forms remain mailto. |
| ThinkTech | Owner URL `https://www.thinktech.com`. TLS handshake from this environment failed; URL still published as supplied. Logo cropped from owner JPEG to `public/partners/thinktech.png`. |
| Social | Instagram `@sherivs_` and Facebook **Sherivs Team** as supplied destinations. X published at `https://x.com/sherivs_`. LinkedIn unpublished pending company page. GitHub omitted. |

## 2. Brand

See `docs/brand/ASSET-INVENTORY.md`. Tokens sampled from the mark: cyan `#14A8FC`, blue `#1848FD`, violet `#8254F6`, field `#080B18`. Fonts remain Inter + Plus Jakarta Sans. Dark chrome uses the compact S plus live white wordmark for contrast; the official lockup is reserved for light surfaces because its letterforms are navy.

## 3. Company facts applied

- Legal entity and Maiduguri location on About, footer, JSON-LD (no street, no TIN).
- Email routing: info / hello / support with distinct form destinations.
- ThinkTech as `technology_partner`, with owner-supplied collaboration copy (development, infrastructure, consulting, integration, marketing). Separate from Paystack/WhatsApp integrations.
- CAC/TIN unpublished identifiers (not requested). NSCDC/NDPA owner-asserted certified; public wording gated.
- Homepage has no customer-availability announcement.

## 4. Limitations

- Mailto is not ticket creation.
- ThinkTech collaboration copy is published; exclusive terms, equity, and joint-venture filings are still not claimed.
- Legal drafts remain noindex pending counsel.
- Instagram and Facebook destinations published as supplied; X published at https://x.com/sherivs_; LinkedIn unpublished; GitHub omitted.
- Production deploy not claimed.
