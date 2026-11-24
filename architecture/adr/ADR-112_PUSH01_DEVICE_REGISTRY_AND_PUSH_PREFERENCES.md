# ADR-112: PUSH-01 Device Registry and Push Preferences

- **Status:** Accepted
- **Date:** 2026-11-24
- **Author:** `copilot-swe-agent[bot]`
- **Migration:** `20261124000000_sherivs_push01_mobile_push_devices.sql`
- **Related to:** `Sherivs/sherivs#487`

## Context

PUSH-02/03 require a durable per-user mobile push endpoint registry and push-specific preference switches.
The existing model stores one `users.push_token`, cannot track multiple devices, and does not support per-category push toggles or timezone defaults.

## Decision

1. Add `public.mobile_push_devices` keyed by `id` with one globally unique `expo_push_token`.
2. Use `org_id` as the neutrality-safe tenant anchor for new rows (FK to `public.schools(id)`).
3. Enforce RLS (`ENABLE` + `FORCE`):
   - owner read (`user_id = auth.uid()`),
   - service-role read (sender path).
4. Deny direct client writes to `mobile_push_devices`; expose only:
   - `public.register_push_device(token, platform, app_version, build)`
   - `public.unregister_push_device(token)`
   Both are `SECURITY DEFINER`, `SET search_path = ''`, and executable by `authenticated` only; registration resolves tenant context via `public.get_my_organization_id()`.
5. Enforce at most 10 active devices per user in `register_push_device`.
6. Ensure token uniqueness across users through `UNIQUE (expo_push_token)` and conflict update in the register RPC (ownership transfer occurs only in RPC path).
7. Extend `public.notification_preferences` with push category booleans and `timezone` default `'Africa/Lagos'`.

## Consequences

- Mobile clients can register and rotate devices safely without direct table mutation.
- Push fanout can rely on service-role reads while preserving owner isolation.
- A lost/stale token can be transferred to the current authenticated owner only through RPC.
- Preference surface now carries push category and timezone settings for later scheduling/quiet-hours logic.

## Rollback

Use `database/supabase/rollbacks/20261124000000_sherivs_push01_mobile_push_devices.sql`.
It drops PUSH-01 RPCs/table and removes PUSH-01 preference columns.

## Residual risk

- `timezone` accepts free text in this phase; canonical IANA validation is deferred to app-level normalization in PUSH-02/03.
- Legacy `users.push_token` remains for backward compatibility and should be retired once all send paths migrate.
