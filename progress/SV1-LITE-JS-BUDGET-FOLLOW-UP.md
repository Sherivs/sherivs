# SV1-LITE JavaScript and image budget follow-up

**Version target:** V1 organizational capability  
**Status:** Planned; not included in the offline-cache change.

The current main JavaScript entry is approximately 604 KB raw (about 185 KB gzip), above the requested 200 KB raw per-route budget. Image compression and automated route-budget enforcement also remain open.

## Plan

1. Record a route-by-route baseline from the production Vite manifest, including raw and gzip sizes for each entry, its shared chunks, and its largest imported dependencies.
2. Reduce route entry graphs first: defer charting, document export, and other feature-only code until the owning route or user action needs it; replace broad barrel imports where they pull unrelated UI into the shared shell.
3. Generate appropriately sized WebP/AVIF image variants and use responsive `srcset`/`sizes`; keep Data Saver on lazy loading and low fetch priority for noncritical media.
4. Add a CI check against the built manifest that fails any route exceeding 200 KB raw JavaScript, and reports shared chunks separately so moving bytes between routes cannot conceal growth.
5. Re-run the same route inventory on desktop and 390px mobile with the existing Slow 3G profile, then record Lighthouse results and transfer sizes as the acceptance evidence.

Do not claim the budget is met until every route passes the manifest check; retain the measured baseline and report exceptions rather than raising the limit silently.
