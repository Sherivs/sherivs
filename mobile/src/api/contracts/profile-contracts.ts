/**
 * CoreGrid Mobile — authentication + organization selection contracts.
 *
 * Authentication semantics mirror the web app exactly (§23): Supabase
 * email/password sign-in over the shared project, session persisted by the
 * platform secure store, and tenant context resolved server-side from the
 * `users` row bound to the authenticated identity (`users.id` = auth user
 * id, `users.school_id` = tenant). The client NEVER supplies a tenant id
 * (Constitution §26) — it can only present what the gate-resolved backend
 * returns.
 *
 * Data minimization (§19): mobile selects only presentation columns. The
 * `schools` table carries payment credentials in the web schema
 * (`paystack_secret_key`); those columns are never requested here, and any
 * such key that nonetheless appears in a response is rejected at
 * validation rather than rendered.
 */
import { z } from "zod";

/** Minimal `users` projection for tenant resolution and identity display. */
export const userProfileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().trim().min(1),
  email: z.string().email().nullable(),
  school_id: z.string().uuid(),
  role: z.string().trim().min(1),
});

export type UserProfile = z.infer<typeof userProfileSchema>;

/** Minimal `schools` projection — public presentation columns only. */
export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  is_active: z.boolean().nullable(),
  primary_color: z.string().nullable(),
});

export type Organization = z.infer<typeof organizationSchema>;

/** Minimal `super_admins` projection (platform-level actors). */
export const superAdminProfileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().trim().min(1),
  email: z.string().email().nullable(),
});

export type SuperAdminProfile = z.infer<typeof superAdminProfileSchema>;

/**
 * Who the authenticated actor is, per the web app's session bootstrap:
 * a tenant-scoped user, a platform super admin, or neither (unprovisioned).
 */
export type ResolvedActor =
  | { readonly kind: "user"; readonly profile: UserProfile; readonly organization: Organization | null }
  | { readonly kind: "super_admin"; readonly profile: SuperAdminProfile }
  | { readonly kind: "unprovisioned" };

export type ActorKind = ResolvedActor["kind"];