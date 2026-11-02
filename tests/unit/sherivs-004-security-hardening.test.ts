import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clientIpFromHeaders,
  escapeXmlText,
  safeMapEmbedSrc,
  safeRelativePath,
} from "../../frontend/src/lib/security/request-safety";
import { verifyHmacHexSignature } from "../../frontend/src/lib/security/webhook-signature.server";
import {
  SECURITY_HEADERS,
  withSecurityHeaders,
} from "../../frontend/src/lib/security/security-headers";
import { urlField } from "../../frontend/src/lib/validation";
import {
  PAYSTACK_FEE_REFERENCE_TTL_MS,
  expectedChargeKobo,
  settlePaystackCharge,
  type SettlementDb,
} from "../../frontend/src/lib/payments/paystack-settlement";
import { canInitiateFeePayment } from "../../frontend/src/lib/payments/fee-payment-access";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("SHERIVS-004 input safety", () => {
  it("safeRelativePath accepts only same-origin relative paths", () => {
    expect(safeRelativePath("/admin/fees?x=1")).toBe("/admin/fees?x=1");
    for (const bad of [
      "//evil.com",
      "https://evil.com",
      "/\\evil.com",
      "javascript:alert(1)",
      "/%2F%2Fevil.com",
      "/a\nb",
      "",
      undefined,
      42,
    ]) {
      expect(safeRelativePath(bad, "/home")).toBe("/home");
    }
  });

  it("safeMapEmbedSrc only passes Google Maps embed https URLs", () => {
    const ok = "https://www.google.com/maps/embed?pb=abc";
    expect(safeMapEmbedSrc(ok)).toBe(ok);
    expect(safeMapEmbedSrc(`<iframe src="${ok}" width="600"></iframe>`)).toBe(ok);
    expect(safeMapEmbedSrc("javascript:alert(1)")).toBeNull();
    expect(
      safeMapEmbedSrc('<iframe src="https://evil.com/x"></iframe> google.com/maps/embed'),
    ).toBeNull();
    expect(safeMapEmbedSrc("https://google.com.evil.com/maps/embed")).toBeNull();
    expect(safeMapEmbedSrc("http://www.google.com/maps/embed")).toBeNull();
    expect(safeMapEmbedSrc(null)).toBeNull();
  });

  it("escapeXmlText escapes ampersand first and cannot be broken out of", () => {
    expect(escapeXmlText("a & <b>")).toBe("a &amp; &lt;b&gt;");
    expect(escapeXmlText("</Say><Dial>1</Dial>")).not.toContain("<");
  });

  it("urlField rejects javascript:/data: schemes", () => {
    expect(urlField.safeParse("https://school.example").success).toBe(true);
    expect(urlField.safeParse("javascript:alert(1)").success).toBe(false);
    expect(urlField.safeParse("data:text/html,<script>").success).toBe(false);
  });

  it("clientIpFromHeaders trusts only the Vercel peer, and Cloudflare's visitor header only behind Cloudflare", () => {
    expect(clientIpFromHeaders(new Headers({ "cf-connecting-ip": "1.2.3.4" }))).toBe("unknown");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "5.6.7.8, 9.9.9.9" }))).toBe(
      "unknown",
    );
    expect(
      clientIpFromHeaders(
        new Headers({
          "x-vercel-forwarded-for": "203.0.113.10",
          "cf-connecting-ip": "1.2.3.4",
          "x-forwarded-for": "5.6.7.8",
        }),
      ),
    ).toBe("203.0.113.10");
    expect(
      clientIpFromHeaders(
        new Headers({
          "x-vercel-forwarded-for": "104.16.1.1",
          "cf-connecting-ip": "203.0.113.50",
        }),
      ),
    ).toBe("203.0.113.50");
    expect(clientIpFromHeaders(new Headers({ "x-vercel-forwarded-for": "x".repeat(65) }))).toBe(
      "unknown",
    );
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });

  it("the public map components never feed raw stored markup to an iframe", () => {
    // Website engine (SHERIVS-100): maps are outbound links only, never an iframe of stored markup.
    const src = read("frontend/src/components/website/blocks.tsx");
    expect(src).toContain("safeUrl(");
    expect(src).not.toMatch(/output=embed|maps\/embed|rawEmbed|dangerouslySetInnerHTML/);
  });
});

describe("SHERIVS-004 webhook signature", () => {
  const secret = "unit-test-secret";
  const body = JSON.stringify({ event: "charge.success" });
  const good = createHmac("sha512", secret).update(body).digest("hex");

  it("accepts a valid HMAC-SHA512 over the raw body", () => {
    expect(verifyHmacHexSignature(body, good, secret)).toBe(true);
  });
  it("rejects tampered body, wrong secret, malformed and missing signatures", () => {
    expect(verifyHmacHexSignature(body + " ", good, secret)).toBe(false);
    expect(verifyHmacHexSignature(body, good, "other")).toBe(false);
    expect(verifyHmacHexSignature(body, "zz", secret)).toBe(false);
    expect(verifyHmacHexSignature(body, good.slice(2), secret)).toBe(false);
    expect(verifyHmacHexSignature(body, null, secret)).toBe(false);
  });
  it("fails closed when the secret is missing", () => {
    expect(verifyHmacHexSignature(body, good, undefined)).toBe(false);
    expect(verifyHmacHexSignature(body, good, "")).toBe(false);
  });
  it("the webhook route reads the key from env, fails closed and uses the shared verifier", () => {
    const route = read("frontend/src/routes/api/public/webhooks/paystack.ts");
    expect(route).toContain("process.env.PAYSTACK_SECRET_KEY");
    expect(route).toContain("requirePaystackTestKey");
    expect(route).toContain("status: 503");
    expect(route).toContain("verifyHmacHexSignature(raw, signature, secret)");
    expect(route).toContain("settlePaystackCharge");
    expect(route).not.toMatch(/\.from\("fees"\)\s*\.update/);
  });
});

type Fee = {
  id: string;
  school_id: string;
  amount: number;
  paid_amount: number | null;
  status: string | null;
  paystack_reference: string | null;
};

function fakeDb(fee: Fee | null) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    from() {
      return {
        select: () => ({
          eq: (_c: string, ref: string) => ({
            maybeSingle: async () => ({
              data: fee && fee.paystack_reference === ref ? fee : null,
              error: null,
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            eq: () => ({
              neq: () => ({
                select: async () => {
                  if (!fee || fee.status === "paid") return { data: [], error: null };
                  updates.push(patch);
                  fee.status = "paid";
                  return { data: [{ id: fee.id }], error: null };
                },
              }),
            }),
          }),
        }),
      };
    },
  } as unknown as SettlementDb;
  return { db, updates };
}

const CURRENT_REFERENCE = `uos_aaaaaaaaaaaaaaaa_${Date.now()}`;
const baseFee = (): Fee => ({
  id: "11111111-1111-4111-8111-111111111111",
  school_id: "22222222-2222-4222-8222-222222222222",
  amount: 50000,
  paid_amount: 10000,
  status: "partial",
  paystack_reference: CURRENT_REFERENCE,
});
const facts = (over: Record<string, unknown> = {}) => ({
  reference: CURRENT_REFERENCE,
  status: "success",
  amountKobo: 4_000_000,
  currency: "NGN",
  metadata: null,
  ...over,
});

describe("SHERIVS-004 paystack settlement (amount/currency/reference)", () => {
  it("expected charge comes from the fee row in kobo", () => {
    expect(expectedChargeKobo({ amount: 50000, paid_amount: 10000 })).toBe(4_000_000);
  });

  it("settles when reference, status, currency and amount match", async () => {
    const { db, updates } = fakeDb(baseFee());
    const r = await settlePaystackCharge(db, facts());
    expect(r.outcome).toBe("settled");
    expect(updates[0]).toMatchObject({ status: "paid", paid_amount: 50000 });
  });

  it("rejects underpayment, overpayment, wrong currency and mismatched metadata without writing", async () => {
    for (const over of [
      { amountKobo: 100 },
      { amountKobo: 9_000_000 },
      { currency: "USD" },
      { currency: undefined },
      { metadata: { fee_id: "99999999-9999-4999-8999-999999999999" } },
      { metadata: { school_id: "99999999-9999-4999-8999-999999999999" } },
    ]) {
      const { db, updates } = fakeDb(baseFee());
      const r = await settlePaystackCharge(db, facts(over));
      expect(r.outcome).toBe("rejected");
      expect(updates).toHaveLength(0);
    }
  });

  it("ignores unsuccessful charges and unknown references", async () => {
    const { db, updates } = fakeDb(baseFee());
    expect((await settlePaystackCharge(db, facts({ status: "failed" }))).outcome).toBe("ignored");
    expect((await settlePaystackCharge(db, facts({ reference: "nope" }))).outcome).toBe("ignored");
    expect(updates).toHaveLength(0);
  });

  it("rejects an expired fee reference without writing", async () => {
    const expiredReference = `uos_aaaaaaaaaaaaaaaa_${Date.now() - PAYSTACK_FEE_REFERENCE_TTL_MS - 1}`;
    const { db, updates } = fakeDb({ ...baseFee(), paystack_reference: expiredReference });
    expect(await settlePaystackCharge(db, facts({ reference: expiredReference }))).toMatchObject({
      outcome: "rejected",
      reason: "expired_reference",
    });
    expect(updates).toHaveLength(0);
  });

  it("accepts a delayed webhook when Paystack confirms payment before reference expiry", async () => {
    const issuedAt = Date.now() - PAYSTACK_FEE_REFERENCE_TTL_MS - 60_000;
    const reference = `uos_aaaaaaaaaaaaaaaa_${issuedAt}`;
    const paymentAt = new Date(issuedAt + PAYSTACK_FEE_REFERENCE_TTL_MS - 1).toISOString();
    const { db, updates } = fakeDb({ ...baseFee(), paystack_reference: reference });
    expect(await settlePaystackCharge(db, facts({ reference, paidAt: paymentAt }))).toMatchObject({
      outcome: "settled",
    });
    expect(updates).toHaveLength(1);
  });

  it("is idempotent: a replayed event is a duplicate with no second write", async () => {
    const { db, updates } = fakeDb(baseFee());
    expect((await settlePaystackCharge(db, facts())).outcome).toBe("settled");
    expect((await settlePaystackCharge(db, facts())).outcome).toBe("duplicate");
    expect(updates).toHaveLength(1);
  });

  it("client verify path settles only through the shared amount-checked settlement", () => {
    const src = read("frontend/src/lib/runtime/scholar/paystack.functions.ts");
    expect(src).toContain("settlePaystackCharge(");
    expect(src).not.toMatch(/paid_amount:\s*body\.data\.amount/);
    expect(src).toContain("canInitiateFeePayment(");
    expect(src).toContain("checkout.paystack.com");
  });
});

describe("SHERIVS-004 fee payment initiation ownership", () => {
  function accessDb(opts: {
    actor: Record<string, unknown> | null;
    parentLink?: boolean;
    self?: boolean;
  }) {
    return {
      from(table: string) {
        const row =
          table === "users"
            ? opts.actor
            : table === "parent_student_map"
              ? opts.parentLink
                ? { student_id: "s" }
                : null
              : opts.self
                ? { id: "s" }
                : null;
        const chain = { maybeSingle: async () => ({ data: row }), eq: () => chain };
        return { select: () => ({ eq: () => chain }) };
      },
    };
  }
  const fee = { school_id: "A", student_id: "s" };

  it("allows finance staff of the same school", async () => {
    expect(
      await canInitiateFeePayment(
        accessDb({ actor: { role: "bursar", school_id: "A" } }),
        "u",
        fee,
      ),
    ).toBe(true);
  });
  it("denies finance staff of another school (tenant isolation)", async () => {
    expect(
      await canInitiateFeePayment(
        accessDb({ actor: { role: "bursar", school_id: "B" } }),
        "u",
        fee,
      ),
    ).toBe(false);
  });
  it("allows the mapped parent and the student, denies unrelated members and inactive users", async () => {
    const actor = { role: "parent", school_id: "A" };
    expect(await canInitiateFeePayment(accessDb({ actor, parentLink: true }), "u", fee)).toBe(true);
    expect(
      await canInitiateFeePayment(
        accessDb({ actor: { role: "student", school_id: "A" }, self: true }),
        "u",
        fee,
      ),
    ).toBe(true);
    expect(await canInitiateFeePayment(accessDb({ actor }), "u", fee)).toBe(false);
    expect(
      await canInitiateFeePayment(
        accessDb({ actor: { role: "admin", school_id: "A", is_active: false } }),
        "u",
        fee,
      ),
    ).toBe(false);
    expect(await canInitiateFeePayment(accessDb({ actor: null }), "u", fee)).toBe(false);
  });
});

describe("SHERIVS-004 security headers", () => {
  it("sets the baseline headers and keeps explicit ones", async () => {
    const res = withSecurityHeaders(
      new Response("x", { headers: { "X-Frame-Options": "SAMEORIGIN" } }),
    );
    expect(res.headers.get("Strict-Transport-Security")).toMatch(/max-age=\d+/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBeTruthy();
    expect(res.headers.get("Permissions-Policy")).toBeTruthy();
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(await res.text()).toBe("x");
  });
  it("full CSP is report-only; the non-breaking framing/object/base/form subset is enforced (Track E)", () => {
    const csp = SECURITY_HEADERS["Content-Security-Policy-Report-Only"];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    const enforced = SECURITY_HEADERS["Content-Security-Policy"];
    expect(enforced).toContain("frame-ancestors 'none'");
    expect(enforced).toContain("object-src 'none'");
    expect(enforced).toContain("base-uri 'self'");
    expect(enforced).not.toContain("script-src");
    expect(SECURITY_HEADERS["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
  });
  it("server.ts applies the headers to every response path", () => {
    const src = read("frontend/src/server.ts");
    expect((src.match(/withSecurityHeaders\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("SHERIVS-004 server function authorization regressions", () => {
  it("createStaffAccount refuses to reuse super admins or other schools' accounts", () => {
    const src = read("frontend/src/lib/runtime/scholar/staff-accounts.functions.ts");
    expect(src).toContain('.from("super_admins")');
    expect(src).toMatch(/userRow\.school_id !== schoolId/);
    expect(src).not.toContain("Math.random");
  });
  it("temporary passwords no longer use Math.random", () => {
    expect(read("frontend/src/lib/runtime/scholar/teachers.functions.ts")).not.toContain(
      "Math.random",
    );
  });
  it("dispatchPushToUsers is staff-gated", () => {
    const src = read("frontend/src/lib/push.functions.ts");
    const idx = src.indexOf("dispatchPushToUsers");
    expect(src.slice(idx, src.indexOf("sendTestPush"))).toContain("requireStaffContext(");
  });
  it("twin call TwiML is escaped via the shared XML escaper and phone is validated", () => {
    const src = read("frontend/src/lib/runtime/scholar/digital-twin.functions.ts");
    expect(src).toContain("escapeXmlText(data.script)");
    expect(src).toMatch(/recipient_phone: z\.string\(\)\.trim\(\)\.regex/);
  });
  it("the password-reset audit endpoint is rate limited before it touches the database", () => {
    const src = read("frontend/src/routes/api/public/audit.password-reset.ts");
    expect(src.indexOf("checkPublicRateLimit(")).toBeGreaterThan(-1);
    expect(src.indexOf("checkPublicRateLimit(")).toBeLessThan(src.indexOf("supabaseAdmin"));
    expect(src).not.toMatch(/Date\.now\s*\(/);
  });
  it("no new dangerouslySetInnerHTML outside the two reviewed sinks", () => {
    const a = read("frontend/src/components/ui/chart.tsx");
    const b = read("frontend/src/routes/__root.tsx");
    expect(a.match(/dangerouslySetInnerHTML/g)).toHaveLength(1);
    expect(b.match(/dangerouslySetInnerHTML/g)).toHaveLength(1);
  });
});
