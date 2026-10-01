/**
 * CoreGrid — V5.3 Part 45: restaurant organizational configuration.
 *
 * The proof of V5.3 Part 64: a SECOND domain binding the SAME universal
 * substrate the Scholar runtime binds, expressed ENTIRELY as a
 * DomainDefinition. Menu, customers, orders, tables, staff, inventory and
 * reservations are ENTITY TYPES + SCHEMA + RELATIONSHIPS + ROLE MAPPINGS +
 * WORKSPACES + WORKFLOWS as configuration — no new universal tables, no
 * restaurant-specific concepts in universal infrastructure, no separate
 * codebase (V5.3 Part 46).
 *
 * Every vocabulary reference is platform-owned: entity types are namespaced
 * into the kernel substrate entity_type vocabulary (V5.3 Part 45 ordering:
 * menu -> customers -> orders -> tables -> staff -> inventory ->
 * reservations), relationship names into the relation_type vocabulary, roles
 * onto the AppRole identity-store vocabulary, workspace kinds onto the
 * runtime nav registry vocabulary, workflows onto the automation engine's
 * workflow vocabulary (names only).
 */
import type { DomainDefinition } from "./domain-definition";
import {
  roleMappingTable,
  type DirectionalRoleMappings,
  type DomainRoleMappingDeclaration,
} from "@/lib/universal-roles";

export const RESTAURANT_DOMAIN_ID = "restaurant";

/* ─────────────────────────────────────────────────────────────
 * Directional role mappings (V1CAP-014 / J-006, CTO RULING-4).
 *
 * The authoritative authorization semantics of this domain: mappings run FROM
 * restaurant roles TO the neutral universal role vocabulary, never the
 * reverse. Finding I-030's seeded contamination is closed here — most
 * importantly service_staff, which used to be forced into the first runtime's
 * identity-store vocabulary because the only target vocabulary that existed
 * WAS that role list. It now resolves to WORKER|OPERATOR: floor workforce
 * semantics with no educator meaning.
 * ────────────────────────────────────────────────────────────*/
export const RESTAURANT_ROLE_MAPPINGS: readonly DomainRoleMappingDeclaration[] = [
  {
    domainRole: "manager",
    neutralRoles: ["ADMINISTRATOR", "OWNER"],
    description:
      "Runs the restaurant: accountable for the operation (OWNER) and configures its structure, staff and settings (ADMINISTRATOR).",
  },
  {
    domainRole: "cashier",
    neutralRoles: ["OPERATOR"],
    description:
      "Handles payments and the cash office: transactional operational authority over the ledger.",
  },
  {
    domainRole: "service_staff",
    neutralRoles: ["WORKER", "OPERATOR"],
    description:
      "Floor service workforce (servers, cooks, hosts): executes assigned service tasks (WORKER) and drives the placed -> in_kitchen -> served order flow (OPERATOR). Deliberately NOT the first runtime's work-product-production semantic — the legacy forced identity-store bridge (I-030) is closed by this declaration.",
  },
  {
    domainRole: "runner",
    neutralRoles: ["WORKER"],
    description: "Field-facing delivery and errand workforce executing assigned tasks.",
  },
];

/** The validated, directional restaurant mapping table (domain -> neutral only). */
export const RESTAURANT_NEUTRAL_ROLE_MAPPINGS: DirectionalRoleMappings =
  roleMappingTable(RESTAURANT_ROLE_MAPPINGS);

export const RESTAURANT_DOMAIN_DEFINITION: DomainDefinition = {
  domainId: RESTAURANT_DOMAIN_ID,
  displayName: "Restaurant operations",
  description:
    "Front-of-house and kitchen operations configuration over the universal CoreGrid substrate.",
  entityTypes: [
    {
      name: "restaurant.menu_item",
      extends: "entity",
      description: "A sellable item on the menu.",
      fields: {
        name: { kind: "string", minLength: 1, maxLength: 120 },
        description: { kind: "string", maxLength: 500 },
        price: { kind: "number", min: 0 },
        category: { kind: "enum", values: ["appetizer", "main", "side", "dessert", "beverage"] },
        is_available: { kind: "boolean" },
      },
    },
    {
      name: "restaurant.customer",
      extends: "entity",
      description: "A guest the restaurant serves.",
      fields: {
        full_name: { kind: "string", minLength: 1, maxLength: 120 },
        phone: { kind: "string", maxLength: 32 },
        is_vip: { kind: "boolean" },
        dietary_notes: { kind: "string", maxLength: 500 },
      },
    },
    {
      name: "restaurant.order",
      extends: "entity",
      description: "A guest order placed against the menu.",
      fields: {
        status: {
          kind: "enum",
          values: ["draft", "placed", "in_kitchen", "served", "paid", "cancelled"],
        },
        total: { kind: "number", min: 0 },
        placed_at: { kind: "string" },
        customer: { kind: "ref", targetType: "restaurant.customer" },
        dining_table: { kind: "ref", targetType: "restaurant.table" },
        served_by: { kind: "ref", targetType: "restaurant.staff" },
      },
    },
    {
      name: "restaurant.table",
      extends: "entity",
      description: "A physical dining table in the restaurant floor plan.",
      fields: {
        label: { kind: "string", minLength: 1, maxLength: 32 },
        seats: { kind: "number", min: 1, integer: true },
        zone: { kind: "enum", values: ["indoor", "outdoor", "bar"] },
        status: { kind: "enum", values: ["free", "occupied", "reserved", "out_of_service"] },
      },
    },
    {
      name: "restaurant.staff",
      extends: "entity",
      description: "A member of the restaurant workforce.",
      fields: {
        full_name: { kind: "string", minLength: 1, maxLength: 120 },
        role: { kind: "enum", values: ["server", "cook", "host", "manager"] },
        is_active: { kind: "boolean" },
      },
    },
    {
      name: "restaurant.inventory_item",
      extends: "entity",
      description: "A stocked supply item the kitchen consumes.",
      fields: {
        name: { kind: "string", minLength: 1, maxLength: 120 },
        unit: { kind: "enum", values: ["kg", "l", "unit"] },
        quantity: { kind: "number", min: 0 },
        reorder_level: { kind: "number", min: 0 },
      },
    },
    {
      name: "restaurant.reservation",
      extends: "entity",
      description: "A booked seating for a party of guests.",
      fields: {
        party_size: { kind: "number", min: 1, integer: true },
        status: {
          kind: "enum",
          values: ["requested", "confirmed", "seated", "cancelled", "no_show"],
        },
        scheduled_for: { kind: "string" },
        customer: { kind: "ref", targetType: "restaurant.customer" },
        dining_table: { kind: "ref", targetType: "restaurant.table" },
      },
    },
  ],
  relationships: [
    {
      name: "restaurant.order_for",
      source: "restaurant.order",
      target: "restaurant.customer",
      cardinality: "many-to-one",
      description: "An order is placed by one customer; a customer places many orders.",
    },
    {
      name: "restaurant.order_line",
      source: "restaurant.order",
      target: "restaurant.menu_item",
      cardinality: "many-to-many",
      description: "An order lists many menu items; a menu item appears on many orders.",
    },
    {
      name: "restaurant.order_table",
      source: "restaurant.order",
      target: "restaurant.table",
      cardinality: "many-to-one",
      description: "An order is served at one dining table.",
    },
    {
      name: "restaurant.fulfilled_by",
      source: "restaurant.order",
      target: "restaurant.staff",
      cardinality: "many-to-one",
      description: "An order is fulfilled by one staff member.",
    },
    {
      name: "restaurant.reserves",
      source: "restaurant.reservation",
      target: "restaurant.customer",
      cardinality: "many-to-one",
      description: "A reservation belongs to one customer.",
    },
    {
      name: "restaurant.seats_reservation",
      source: "restaurant.reservation",
      target: "restaurant.table",
      cardinality: "many-to-one",
      description: "A reservation holds one dining table.",
    },
    {
      name: "restaurant.consumes_stock",
      source: "restaurant.menu_item",
      target: "restaurant.inventory_item",
      cardinality: "many-to-many",
      description:
        "Preparing a menu item consumes many stocked items; a stocked item feeds many menu items.",
    },
  ],
  roles: [
    /*
     * Recertified neutral-only (MISSION-R-120 / V1CAP-093, closing the I-031
     * backwards-compatibility path for THIS fixture): every restaurant role
     * resolves through the authoritative RESTAURANT_ROLE_MAPPINGS table — no
     * legacy identity-store declaration remains. The validator accepts EITHER
     * appRoles OR neutralRoles (never neither); this fixture declares ONLY the
     * neutral vocabulary, which is what a second-domain fixture must prove.
     */
    {
      domainRole: "manager",
      neutralRoles: RESTAURANT_NEUTRAL_ROLE_MAPPINGS.manager,
      description: "Runs the restaurant; accountable for the operation and its administration.",
    },
    {
      domainRole: "cashier",
      neutralRoles: RESTAURANT_NEUTRAL_ROLE_MAPPINGS.cashier,
      description: "Handles payments and the cash office.",
    },
    {
      domainRole: "service_staff",
      // Neutral-only declaration (I-031): resolved through the authoritative
      // RESTAURANT_ROLE_MAPPINGS table — no legacy identity-store bridge.
      neutralRoles: RESTAURANT_NEUTRAL_ROLE_MAPPINGS.service_staff,
      description:
        "Floor service workforce (servers, cooks, hosts). Neutral semantics: WORKER|OPERATOR (see RESTAURANT_ROLE_MAPPINGS).",
    },
    {
      domainRole: "runner",
      neutralRoles: RESTAURANT_NEUTRAL_ROLE_MAPPINGS.runner,
      description: "Field-facing delivery and errand workforce.",
    },
  ],
  workspaces: [
    /*
     * I-012 follow-through — WORKSPACE-KIND DEBT, documented-gated (consumer
     * list below). Every workspace kind string here is drawn from the first
     * runtime's chrome-kind vocabulary, not a neutral one — most visibly the
     * `restaurant-service` workspace's kind, which reads as education
     * vocabulary while carrying NO educator semantic. A neutral kind
     * ("operations") was evaluated and is NOT permitted by current
     * consumers: a DomainWorkspace.kind must be a member of the runtime nav
     * registry's closed kind union (typed as RuntimeNavKind and validated
     * fail-closed by validateDomainDefinition against the gate's routed-kind
     * vocabulary), and that union is today the first runtime's
     * ScholarNavKind (finding I-013). The runtime-declared workspace-kind
     * vocabulary that would admit a domain-owned kind is future work
     * (V1CAP-084), so the kind string stays — a chrome-kind BORROW, never an
     * educator semantic of any restaurant role (all four resolve through
     * RESTAURANT_ROLE_MAPPINGS above; none carries work-product-production
     * semantics).
     *
     * Consumers of this kind string (exhaustive, verified by grep):
     *  - tests/unit/domain-config-restaurant.test.ts ("uses only runtime nav
     *    registry kinds for its workspaces"; "resolves both domains'
     *    workspaces from the SAME runtime nav registry vocabulary")
     *  - tests/unit/domain-runtime-recertification.test.ts (documents the
     *    debt as the certification's recorded exception)
     *  - validateDomainDefinition (frontend/src/lib/domain-config/
     *    domain-definition.ts — fail-closed kind check against the registry
     *    vocabulary)
     * The fixture has NO other consumer (no route, storage or runtime
     * surface reads it — it is a configuration fixture). When the
     * runtime-declared workspace-kind vocabulary lands, rename this kind and
     * ratchet the two assertions above.
     */
    {
      name: "restaurant-manager",
      kind: "org_admin",
      label: "Restaurant manager",
      description: "Manager chrome, resolved from the runtime nav registry org_admin kind.",
    },
    {
      name: "restaurant-service",
      // TODO(I-012/V1CAP-084): legacy chrome-kind string, documented-gated —
      // see the consumer list above before touching. Rename to a
      // domain-owned neutral kind only when the runtime nav registry admits
      // runtime-declared kinds.
      kind: "teacher",
      label: "Floor service",
      description:
        "Service workforce chrome. The kind string is the documented-gated chrome-kind borrow (see the workspaces note above); the role semantics are the neutral WORKER|OPERATOR mapping.",
    },
    {
      name: "restaurant-cashier",
      kind: "bursar",
      label: "Cash office",
      description: "Cashier chrome, resolved from the runtime nav registry bursar kind.",
    },
  ],
  workflows: [
    {
      name: "restaurant.order_lifecycle",
      description:
        "Placed -> in_kitchen -> served -> paid (automation engine workflow vocabulary).",
    },
    {
      name: "restaurant.reservation_lifecycle",
      description: "Requested -> confirmed -> seated (automation engine workflow vocabulary).",
    },
    {
      name: "restaurant.inventory_reorder",
      description: "Stock below reorder level -> replenishment workflow.",
    },
  ],
};
