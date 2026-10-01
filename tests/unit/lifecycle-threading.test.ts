/**
 * DEFECT-1 follow-through — lifecycle-signal threading at the server-function
 * call sites (wave 2 residual fixes).
 *
 * The runtime gate layer (`frontend/src/lib/security-role-gate.ts`) accepts
 * `LifecycleSignals` with fail-closed semantics; this suite pins the
 * follow-through that every `*.functions.ts` call site of the gate adapters
 * now SUPPLIES those signals:
 *
 * - the authenticated request context (`requireSupabaseAuth`) carries the
 *   verified token claims; session validity is attested from the `exp` claim;
 * - the JWT carries NO identity-lifecycle claim, so call sites supply the
 *   explicit unverified marker (`lifecycle: null`) — the allow is then flagged
 *   `lifecycleUnverified: true` instead of being silently unattested.
 *
 * Fail-closed both ways: an expired/unparseable `exp` yields
 * `sessionValid: false`, which DENIES; a call site that supplies no signal at
 * all keeps historical behavior and is caught by the source audit below.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import {
  checkLifecycleSignals,
  requirePlatformSuperAdmin,
  requireSchoolAdminScope,
  requireStaffContext,
  resolveRoleGate,
  type LifecycleSignals,
} from "@/lib/security-role-gate";

const SCHOOL_A = "11111111-1111-1111-1111-111111111111";

function rpcClient(
  results: Record<string, unknown>,
): Parameters<typeof requireSchoolAdminScope>[0] {
  return {
    rpc(name: string) {
      if (!(name in results)) {
        return Promise.resolve({ data: null, error: { message: `unexpected rpc: ${name}` } });
      }
      return Promise.resolve({ data: results[name], error: null });
    },
  } as unknown as Parameters<typeof requireSchoolAdminScope>[0];
}

/** The exact marker shape the `*.functions.ts` call sites supply. */
function threadedSignals(claims: { exp: number | undefined }): LifecycleSignals {
  return {
    lifecycle: null,
    sessionValid: tokenMsRemaining(claims.exp) > 0,
  };
}

describe("threaded marker semantics (checkLifecycleSignals at the call sites)", () => {
  it("an unexpired exp attests the session; the unverified lifecycle stays flagged, never silent", () => {
    const now = new Date();
    const check = checkLifecycleSignals(
      threadedSignals({ exp: now.getTime() / 1000 + 60 }),
    );
    expect(check).toEqual({ ok: true, lifecycleUnverified: true });
  });

  it("a missing exp fails closed (sessionValid=false denies with session_denied)", () => {
    const check = checkLifecycleSignals(threadedSignals({ exp: undefined }));
    expect(check).toMatchObject({ ok: false, code: "session_denied" });
  });

  it("an expired exp denies with session_denied (AGENTS §31: expired access fails)", () => {
    const now = new Date();
    const check = checkLifecycleSignals(threadedSignals({ exp: now.getTime() / 1000 - 1 }));
    expect(check).toMatchObject({ ok: false, code: "session_denied" });
  });
});

describe("threaded marker through the RPC adapters", () => {
  it("requireSchoolAdminScope resolves flagged-unverified and denies an expired session", async () => {
    const supabase = rpcClient({ is_school_admin: true, get_my_school_id: SCHOOL_A });
    const now = new Date();
    await expect(
      requireSchoolAdminScope(supabase, threadedSignals({ exp: now.getTime() / 1000 + 60 })),
    ).resolves.toBe(SCHOOL_A);
    await expect(
      requireSchoolAdminScope(supabase, threadedSignals({ exp: now.getTime() / 1000 - 1 })),
    ).rejects.toThrow("session is expired or revoked");
  });

  it("requireStaffContext resolves flagged-unverified and denies a revoked session", async () => {
    const supabase = rpcClient({ get_my_role: "teacher", get_my_school_id: SCHOOL_A });
    const now = new Date();
    await expect(
      requireStaffContext(supabase, "school_teacher", {
        ...threadedSignals({ exp: now.getTime() / 1000 + 60 }),
      }),
    ).resolves.toMatchObject({ role: "teacher", schoolId: SCHOOL_A });
    await expect(
      requireStaffContext(supabase, "school_teacher", { sessionValid: false }),
    ).rejects.toThrow("session is expired or revoked");
  });

  it("resolveRoleGate and requirePlatformSuperAdmin thread the marker", async () => {
    const supabase = rpcClient({ is_super_admin: true });
    const now = new Date();
    const outcome = await resolveRoleGate(
      supabase,
      "platform_super_admin",
      threadedSignals({ exp: now.getTime() / 1000 + 60 }),
    );
    expect(outcome).toMatchObject({ decision: "allow", lifecycleUnverified: true });
    await expect(
      requirePlatformSuperAdmin(supabase, threadedSignals({ exp: now.getTime() / 1000 + 60 })),
    ).resolves.toBeUndefined();
  });
});

/* ─────────────────────────────────────────────────────────────
 * Source audit: every adapter call site in every *.functions.ts
 * file supplies lifecycle signals. Two threading shapes are
 * legitimate: the inline unverified marker (`lifecycle: null`)
 * or a named `lifecycle` signals variable built earlier in the
 * handler (e.g. staff-accounts). Either way, the adapter's
 * argument list must mention `lifecycle` — a call site with no
 * signal at all fails the audit.
 * ────────────────────────────────────────────────────────────*/

const ADAPTER_INVOCATION = /\b(?:requireSchoolAdminScope|requireStaffContext|resolveRoleGate|requirePlatformSuperAdmin|resolveStaffContext|assertRoleScope)\(/g;

/** Extract the full argument text of every adapter invocation (paren-balanced). */
function invocationArgs(source: string): string[] {
  const args: string[] = [];
  for (const match of source.matchAll(ADAPTER_INVOCATION)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let end = start;
    while (end < source.length && depth > 0) {
      const ch = source.charAt(end);
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      end += 1;
    }
    args.push(source.slice(start, depth === 0 ? end - 1 : end));
  }
  return args;
}

describe("lifecycle-threading source audit (*.functions.ts call sites)", () => {
  const libDir = path.resolve(import.meta.dirname, "../../frontend/src/lib");
  const functionsFiles = readdirSync(libDir)
    .filter((name) => name.endsWith(".functions.ts"))
    .sort();

  it("finds the audited function families", () => {
    expect(functionsFiles.length).toBeGreaterThan(0);
  });

  for (const file of functionsFiles) {
    it(`threads every gate call site in ${file}`, () => {
      const source = readFileSync(path.join(libDir, file), "utf8");
      if (!/security-role-gate/.test(source)) return; // family does not use the gate
      const calls = invocationArgs(source);
      expect(calls.length, `${file}: expected at least one adapter call site`).toBeGreaterThan(0);
      for (const [index, args] of calls.entries()) {
        expect(
          args,
          `${file}: adapter call site #${index + 1} supplies no lifecycle signals ` +
            `(expected the inline \`lifecycle: null\` marker or a lifecycle signals variable)`,
        ).toMatch(/\blifecycle\b/);
      }
    });
  }
});
