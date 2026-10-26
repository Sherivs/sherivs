# SHERIVS-ENTERPRISE-PUBLIC-WEBSITE-001

Version-target classification: **ACTIVE-V1** (public marketing and documentation only). V2 device/IoT and V3 Reality Intelligence remain frozen.

## 1. Repository audit (2026-10-26)

| Item | Finding |
|------|---------|
| Root / branch at start | `/workspace`, `master` @ `53557e07` |
| Unrelated dirty file | `package-lock.json` (left unstaged) |
| Stack | TanStack Start/Router, Vite, React 19, TypeScript, Tailwind 4, Supabase, Vercel — **not migrated** |
| Hosts | `sherivs.com` / `www.sherivs.com` public; `app.sherivs.com` splash / sign-in / team onboarding; `console.sherivs.com` / gov/head/group shells **retired** (unavailable surface, not the marketing homepage) |
| Existing Plane A routes | `/`, `/about`, `/contact`, `/request-demo`, `/sherivs`, `/coregrid`→`/sherivs`, `/privacy-policy`, `/terms`, `/status`, verification tools |
| Collision: `/platform` | Hardcoded internal dashboard **removed**. Public architecture lives at `/product/*` and `/sherivs`. |
| Collision: `/blog` | Hardcoded tenant leftover blog **removed**. Company writing is `/insights`. |
| Forms | Previously mailto-only. Public forms now compose mailto; they never claim a ticket exists. |
| Fonts | Inter + Plus Jakarta Sans (existing). No third family. |
| Brand color | Logo primary `#184EFD` (not the proposed `#4263FF`). |

## 2. Route map implemented

Public product and company routes under `(site)/`. Redirects: `/product`→`/sherivs`, `/company/about`→`/about`, `/legal/privacy`→`/privacy-policy`, `/legal/terms`→`/terms`, `/coregrid`→`/sherivs`.

Hardcoded `/platform` and leftover tenant `/blog` routes have been removed. The public website and website-engine tenant sites remain.

## 3. Missing owner-provided information

See `docs/public-site/OWNER-INFORMATION-NEEDED.md`.

## 4. Nested-route layout fix

TanStack file routes `foo.tsx` + `foo.bar.tsx` treat `foo.tsx` as a parent layout. A `beforeLoad` redirect on `product.tsx` therefore sent `/product/architecture` (and siblings) to `/sherivs`. Parents without `<Outlet />` also hid child pages such as `/solutions/education`.

Parents are now Outlet layouts; index content lives in `*.index.tsx`. `/product` still redirects to `/sherivs`.

## 5. Known limitations

- No public helpdesk backend; support/demo/contact use the visitor's mail client.
- Legal drafts are noindex until counsel/owner approval.
- No partner logos, certifications, social links, or legal entity address.
- Public developer API/SDK is planned, not published.
- Lighthouse scores are not claimed without a measured run against production.

## 6. Recommended next improvements

- Owner-approved legal entity, DPA, subprocessors, and cookie table.
- Working lead capture (authenticated server function) if email-only is insufficient.
- Real announcement when there is one.
- Host-guard so tenant sites do not inherit company chrome on `/{about,contact,...}`.
- Visual QA on production fonts/logo at `www.sherivs.com`.
