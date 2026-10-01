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
 * importantly service_staff, which used to be forced into the Scholar
 * identity-store vocabulary (service_staff -> teacher) because the only
 * target vocabulary that existed WAS the Scholar role list. It now resolves
 * to WORKER|OPERATOR: floor workforce semantics with no educator meaning.
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
      "Floor service workforce (servers, cooks, hosts): executes assigned service tasks (WORKER) and drives the placed -> in_kitchen -> served order flow (OPERATOR). Deliberately NOT the Scholar educator semantic — the legacy service_staff -> teacher forced mapping (I-030) is closed by this declaration.",
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
     * LEGACY appRoles BRIDGE (I-030/I-031): these identity-store entries exist
     * ONLY because the current DomainDefinition validator still validates roles
     * against the legacy identity-store vocabulary. The authoritative
     * authorization semantics of this domain are RESTAURANT_ROLE_MAPPINGS
     * above (directional, neutral). When the validator re-points at the
     * neutral vocabulary (I-031 follow-through), this bridge is deleted.
     */
    {
      domainRole: "manager",
      appRoles: ["admin", "principal"],
      description: "Runs the restaurant; maps onto the organization-administration membership.",
    },
    {
      domainRole: "cashier",
      appRoles: ["bursar"],
      description: "Handles payments and the cash office.",
    },
    {
      domainRole: "service_staff",
      // Forced legacy validator entry (I-030/I-031) — NOT an authorization
      // mapping. The neutral resolution of service_staff is WORKER|OPERATOR
      // (RESTAURANT_ROLE_MAPPINGS); no code path resolves service_staff
      // through the legacy value below.
      appRoles: ["teacher"],
      description:
        "Floor service workforce (servers, cooks, hosts). Neutral semantics: WORKER|OPERATOR (see RESTAURANT_ROLE_MAPPINGS).",
    },
    {
      domainRole: "runner",
      appRoles: ["driver"],
      description: "Field-facing delivery and errand workforce.",
    },
  ],
  workspaces: [
    {
      name: "restaurant-manager",
      kind: "org_admin",
      label: "Restaurant manager",
      description: "Manager chrome, resolved from the runtime nav registry org_admin kind.",
    },
    {
      name: "restaurant-service",
      kind: "teacher",
      label: "Floor service",
      description: "Service workforce chrome, resolved from the runtime nav registry teacher kind.",
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
