/**
 * CoreGrid Mobile — canonical database type source (Constitution §23).
 *
 * The generated row-type contract lives in the web application's integration
 * layer and is the ONE typed source of truth for Postgrest row shapes.
 * Mobile consumes it as a TYPE-ONLY import: it is erased at compile time, so
 * no web source ever enters the mobile bundle, while any change to the
 * canonical row shapes still fails mobile's typecheck (contract parity is a
 * compile-time obligation, mirroring the V1CAP-052 typed-mapping pattern).
 *
 * Follow-up (reported, not performed — frontend/ is read-only for V1-010):
 * extract `frontend/src/integrations/supabase/types.ts` and the pure
 * contract vocabulary modules into a shared workspace package so web and
 * mobile import one physical source.
 */
import type { Database } from "../../../../frontend/src/integrations/supabase/types";

export type CoreGridDatabase = Database;