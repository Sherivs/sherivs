-- =============================================================================
-- CoreGrid V1 — governed event routing & subscription persistence (MISSION-R-63)
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED. Do not treat this file as a live database.
-- Apply only with an explicit human authorization decision (governance law):
--   supabase db push --workdir database/supabase
-- Rollback (not applied by this migration):
--   database/supabase/rollbacks/20261002000007_coregrid_v1_event_routing.sql
--
-- Authority:
--   Contract: frontend/src/lib/kernel/event-routing.ts (V1CAP-043 / J-021 /
--   MISSION-R-63) — tenant-scoped event routing & subscriptions, composed
--   over the per-event security contract (V1CAP-044 / J-022 / MISSION-R-81)
--   and the event kernel semantics (V1CAP-042 / J-020 / MISSION-R-15).
--   Chain: G-043 + Constitution §35 demand the governed subscription half of
--   the event plane — realtime must respect tenant, authorization,
--   subscriptions and privacy; the routing layer REUSES deliverEvent as the
--   single authorization enforcement point and never re-implements it.
--   Style exemplar: 20261002000004_coregrid_v1_memory_tier.sql.
--
-- Scope:
--   cg_event_route_subscription — declared subscriptions (server-resolved
--       truth, immutable while it exists): subscriber identity, tenant scope,
--       event-type filter over the registered taxonomy, declared visibility
--       scope set, declared sensitivity ceiling, and the delivery semantics
--       (tenant total order, content+cause digest dedup, bounded undelivered
--       queue) plus the active/suspended state.
--   cg_event_route_queue       — the bounded undelivered queue: one row per
--       enqueued gated delivery, keyed by the event's content+cause digest
--       (dedup across live routing, pending queues and replay alike).
--   cg_event_route_cursor      — the one-way delivery frontier per
--       subscription: last delivered event ref, delivered count. A late
--       event (its total-order position precedes the cursor) is never
--       delivered — fail-closed, auditable.
--   cg_event_route_outcome     — append-only routing outcome audit: one row
--       per event × subscription evaluation (queued / denied / duplicate /
--       late / overload / suspended) with the gated delivery or the denial
--       record. NOTHING is silently dropped.
--
-- Declaration immutability law (contract): a subscription declaration is
--   IMMUTABLE while it exists — re-subscription must re-declare it
--   identically; a scope change is a retire + a NEW subscription identity.
--   The declaration columns are pinned at write time and verified by the
--   adapter against the canonical declaration JSON; no in-place rewrite path
--   is authored. Suspension lifts ONLY on explicit identical re-subscription.
--
-- Append-only audit law: cg_event_route_outcome carries NO foreign key to
--   the subscription: the audit trail survives unsubscribe (mirrors
--   cg_memory_access_log — immutable audit records, Constitution §28/§29).
--
-- Tenant posture (COND-003 parameterization, UNRESOLVED):
--   tenant_id is `text NOT NULL CHECK (length 1..128)` per applied reality
--   (cg_identity.tenant_id and the worker-definitions exemplar). If COND-003
--   rules uuid (MISSION-R-02), a follow-up migration converts the substrate.
--   Subscriptions are tenant-scoped by construction; tenant isolation is
--   additionally enforced by the consumption gate before delivery.
--
-- Envelope posture:
--   Subscriptions, queue entries, cursors and outcomes are routing state
--   bound to kernel events, NOT canonical CoreObjects: the event itself is
--   the canonical object and its envelope lives on the event substrate. No
--   envelope columns are authored here.
--
-- Deliberately NOT in scope:
--   • RLS policies: ZERO policies authored (deny-by-default strongest form;
--     policies come later from the policy team and the RLS battery).
--   • Event persistence itself — the cg_event substrate is owned by the
--     event-kernel phase; queue rows reference the event's dedup digest and
--     carry the gated view, never a second copy of the event record.
--   • The security-contract persistence (contracts, denials, redactions) —
--     owned by the event-security migration 20261002000006.
--   • Delivery TRANSPORT (push channels, websocket fanout, notifications
--     fanout phase 10) — routing decides WHAT is deliverable to WHOM; the
--     transport is a separate concern.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cg_event_route_subscription — declared, immutable subscriptions
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_event_route_subscription (
  id                text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  tenant_id         text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  subscriber_id     text NOT NULL CHECK (length(subscriber_id) BETWEEN 1 AND 200),
  -- Declared event-type filter over the registered taxonomy. An EMPTY array
  -- declares every registered type (the declaration itself is the auditable
  -- scope); types outside the filter never route to this subscription.
  event_types       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(event_types) = 'array'),
  -- Declared visibility scopes this subscriber is authorized to receive.
  visibility_scopes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(visibility_scopes) = 'array'),
  -- Declared sensitivity ceiling (J-011 data-scope law).
  max_sensitivity   text NOT NULL CHECK (max_sensitivity IN ('public','internal','restricted')),
  -- Delivery semantics (closed, fail-closed): the only lawful posture in V1
  -- is the tenant total order with content+cause digest deduplication —
  -- arrival order is never a delivery order.
  ordering          text NOT NULL CHECK (ordering = 'tenant-total-order'),
  dedup             text NOT NULL CHECK (dedup = 'collapse-duplicates'),
  max_undelivered   integer NOT NULL CHECK (max_undelivered > 0),
  -- active | suspended. Suspension is a first-class state (overload
  -- backpressure), never a silent drop; it lifts ONLY on explicit identical
  -- re-subscription.
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  declared_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);

COMMENT ON TABLE public.cg_event_route_subscription IS
  $comment$MISSION-R-63 / J-021 (V1CAP-043) declared event subscription:
  server-resolved truth (client declarations are never trusted beyond this
  validated shape — Constitution §26), immutable while it exists (re-
  subscription must re-declare identically; a scope change is a retire plus a
  NEW subscription identity), tenant-scoped, with a declared event-type
  filter, visibility scope set, sensitivity ceiling and bounded delivery
  semantics (tenant total order, digest dedup, bounded undelivered queue).$comment$;

CREATE INDEX IF NOT EXISTS cg_event_route_subscription_tenant_idx
  ON public.cg_event_route_subscription (tenant_id, status);

CREATE INDEX IF NOT EXISTS cg_event_route_subscription_subscriber_idx
  ON public.cg_event_route_subscription (subscriber_id, tenant_id);

-- -----------------------------------------------------------------------------
-- 2. cg_event_route_queue — the bounded undelivered queue
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_event_route_queue (
  subscription_id  text NOT NULL CHECK (length(subscription_id) BETWEEN 1 AND 200),
  tenant_id        text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  -- The event's content+cause digest (event-semantics vocabulary, composed —
  -- never redefined): the dedup identity across live routing, pending queues
  -- and replay alike; also the queue key so a duplicate enqueue collapses.
  event_digest     text NOT NULL CHECK (event_digest ~ '^[0-9a-f]{64}$'),
  event_ref        text NOT NULL CHECK (length(event_ref) BETWEEN 1 AND 200),
  -- The gated delivery for this queue entry: the ALLOW view, or the REDACT
  -- view with its redaction records attached. Never an ungated event.
  delivery_decision text NOT NULL CHECK (delivery_decision IN ('ALLOW','REDACT')),
  delivery         jsonb NOT NULL CHECK (jsonb_typeof(delivery) = 'object'),
  -- pending | delivered. Delivered rows are KEPT for dedup history (the
  -- contract's seenDigests spans enqueued AND delivered).
  state            text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','delivered')),
  enqueued_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at     timestamptz,
  PRIMARY KEY (subscription_id, event_digest),
  CONSTRAINT cg_event_route_queue_subscription_fk
    FOREIGN KEY (subscription_id, tenant_id)
    REFERENCES public.cg_event_route_subscription (id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT cg_event_route_queue_delivered_instant CHECK (
    (state = 'delivered' AND delivered_at IS NOT NULL)
    OR (state = 'pending' AND delivered_at IS NULL)
  )
);

COMMENT ON TABLE public.cg_event_route_queue IS
  $comment$MISSION-R-63 / J-021 bounded undelivered queue per subscription,
  keyed by the event's content+cause digest (dedup identity — a duplicate
  delivery collapses, never delivered twice). Each row carries the GATED
  delivery (ALLOW view or REDACT view with redaction records) — the gate
  (deliverEvent) decided, the queue never re-decides. Delivered rows are
  retained for dedup history. The queue bound (max_undelivered) suspends the
  subscription for overload when exceeded — explicit, auditable, resumable
  only by re-subscription.$comment$;

CREATE INDEX IF NOT EXISTS cg_event_route_queue_pending_idx
  ON public.cg_event_route_queue (subscription_id, state, enqueued_at);

-- -----------------------------------------------------------------------------
-- 3. cg_event_route_cursor — the one-way delivery frontier
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_event_route_cursor (
  subscription_id  text PRIMARY KEY CHECK (length(subscription_id) BETWEEN 1 AND 200),
  tenant_id        text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128),
  -- The last DELIVERED event (the one-way total-order frontier): an event
  -- whose tenant-total-order position precedes this cursor is "late" — its
  -- position cannot be honored, it is not delivered, the fact is auditable.
  last_event_ref   text CHECK (last_event_ref IS NULL OR length(last_event_ref) BETWEEN 1 AND 200),
  delivered_count  bigint NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cg_event_route_cursor_subscription_fk
    FOREIGN KEY (subscription_id, tenant_id)
    REFERENCES public.cg_event_route_subscription (id, tenant_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.cg_event_route_cursor IS
  $comment$MISSION-R-63 / J-021 one-way delivery frontier per subscription:
  the last delivered event and the delivered count. The frontier is
  one-way — delivery never rewinds, a late event is never re-ordered into
  history (fail-closed, auditable; recovery is a NEW subscription identity
  replaying from a sequence point).$comment$;

-- -----------------------------------------------------------------------------
-- 4. cg_event_route_outcome — append-only routing outcome audit
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cg_event_route_outcome (
  id               text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  tenant_id        text CHECK (tenant_id IS NULL OR length(tenant_id) BETWEEN 1 AND 128),
  subscription_id  text NOT NULL CHECK (length(subscription_id) BETWEEN 1 AND 200),
  subscriber_id    text NOT NULL CHECK (length(subscriber_id) BETWEEN 1 AND 200),
  event_ref        text NOT NULL CHECK (length(event_ref) BETWEEN 1 AND 200),
  -- Closed outcome vocabulary: queued | denied | duplicate | late | overload
  -- | suspended. Every evaluation leaves a row — nothing silently dropped.
  kind             text NOT NULL CHECK (kind IN
                     ('queued','denied','duplicate','late','overload','suspended')),
  -- The gate's denial record for `denied` outcomes (closed
  -- EventDenialReason vocabulary); null otherwise.
  denial_reason    text CHECK (denial_reason IS NULL OR denial_reason IN
                     ('missing_security_contract','invalid_security_contract',
                      'unverifiable_issuance','tampered_digest',
                      'generated_event_claims_observation','tenant_mismatch',
                      'visibility_not_authorized','sensitivity_not_authorized')),
  -- The gated delivery for `queued` outcomes; null for every other kind.
  delivery         jsonb CHECK (delivery IS NULL OR jsonb_typeof(delivery) = 'object'),
  -- The backpressure record when this outcome triggered the suspension.
  backpressure     jsonb CHECK (backpressure IS NULL OR jsonb_typeof(backpressure) = 'object'),
  detail           text NOT NULL DEFAULT '',
  -- NO foreign key to the subscription: the audit trail survives unsubscribe
  -- (immutable audit record, Constitution §28/§29).
  recorded_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cg_event_route_outcome IS
  $comment$MISSION-R-63 / J-021 append-only routing outcome audit: one row per
  event × subscription evaluation (queued / denied / duplicate / late /
  overload / suspended) with the gated delivery, the gate's denial record or
  the backpressure record. There is NO broadcast primitive and NO silent
  drop — every evaluation is observable. The outcome carries no foreign key
  to the subscription: the audit trail survives unsubscribe (immutable audit
  record, Constitution §28); no UPDATE or DELETE path is authored.$comment$;

CREATE INDEX IF NOT EXISTS cg_event_route_outcome_tenant_idx
  ON public.cg_event_route_outcome (tenant_id, recorded_at);

CREATE INDEX IF NOT EXISTS cg_event_route_outcome_subscription_idx
  ON public.cg_event_route_outcome (subscription_id, recorded_at);

CREATE INDEX IF NOT EXISTS cg_event_route_outcome_kind_idx
  ON public.cg_event_route_outcome (kind, recorded_at);

-- -----------------------------------------------------------------------------
-- 5. Deny-by-default security posture
-- -----------------------------------------------------------------------------
-- RLS ENABLED with ZERO policies and all anon/authenticated privileges
-- REVOKED (mirrors the memory-tier / worker-definitions substrate posture).
-- Zero policies are deliberate: subscription declarations, gated queues and
-- routing audit are tenant-sensitive platform security data (Constitution
-- §17/§35) and no tenant-scoped policy yet exists that provably cannot widen
-- delivery beyond a subscription's declared ceiling — access runs through
-- service-role server functions that enforce the consumption gate through
-- the adapter. Policies may be authored by a follow-up migration under
-- explicit authorization, never silently.
-- =============================================================================

ALTER TABLE public.cg_event_route_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_event_route_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_event_route_cursor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cg_event_route_outcome ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cg_event_route_subscription FROM anon, authenticated;
REVOKE ALL ON public.cg_event_route_queue FROM anon, authenticated;
REVOKE ALL ON public.cg_event_route_cursor FROM anon, authenticated;
REVOKE ALL ON public.cg_event_route_outcome FROM anon, authenticated;

-- =============================================================================
-- End of migration. Verification (run after apply authorization):
--   • all four tables exist with rowsecurity = true and zero policies in
--     pg_policies;
--   • anon/authenticated hold NO privileges on any of the four tables;
--   • subscription rows reject zero/negative queue bounds, unregistered
--     delivery semantics, and cross-tenant queue/cursor bindings
--     (composite FKs);
--   • queue rows reject delivered entries without a delivered instant (and
--     pending entries with one);
--   • outcomes record every evaluation kind with closed vocabularies and
--     audit instants, and survive subscription removal (no FK).
-- The TypeScript adapter (frontend/src/lib/adapters/event-routing-store.adapter.ts)
-- and its suite pin the migration text mechanically until live verification
-- is authorized.
-- =============================================================================