import { describe, expect, it } from "vitest";
import { applyTransform, batchKey, mapRow, suggestMappings } from "@/lib/integrations-hub/sdk";
import { parseDelimited, previewImport } from "@/lib/integrations-hub/connectors/csv";
import { signWebhook, verifyWebhook } from "@/lib/integrations-hub/connectors/rest-webhook";
import { mapCourse } from "@/lib/integrations-hub/connectors/google-classroom";

describe("CSV importer", () => {
  it("parses quoted fields, BOM, CRLF and embedded commas", () => {
    const p = parseDelimited(
      '\uFEFFAdm No,Surname,First Name,DOB\r\n"ADM/001","Okafor, Jr",Chidi,05/09/2012\r\nADM/002,Bello,Aisha,"1/2/2013"\r\n',
    );
    expect(p.headers).toEqual(["Adm No", "Surname", "First Name", "DOB"]);
    expect(p.rows[0].Surname).toBe("Okafor, Jr");
    expect(p.rows).toHaveLength(2);
  });
  it("suggests mappings, dedupes in-file duplicates, skips rows without id", () => {
    const p = parseDelimited(
      "Adm No,Surname,First Name,DOB,Parent Phone\nADM/1,Okafor,Chidi,05/09/2012,08031234567\nADM/1,Okafor,Chidi,05/09/2012,08031234567\n,No,Id,,\n",
    );
    const m = suggestMappings(p.headers, "student");
    expect(m.find((x) => x.target === "admission_number")?.source).toBe("Adm No");
    const pv = previewImport(p.rows, m);
    expect(pv.records).toHaveLength(1);
    expect(pv.duplicates).toEqual(["ADM/1"]);
    expect(pv.skipped).toBe(1);
    expect(pv.records[0].data.date_of_birth).toBe("2012-09-05");
    expect(pv.records[0].data.guardian_phone).toBe("+2348031234567");
  });
  it("transforms naira and rejects bad phones", () => {
    expect(applyTransform("₦45,000.50", "naira_kobo")).toBe(4500050);
    expect(applyTransform("12345", "phone_ng")).toBeNull();
    expect(mapRow({ a: "" }, [{ source: "a", target: "admission_number" }])).toBeNull();
  });
  it("same batch gives the same idempotency key", async () => {
    const r = [{ external_id: "1", data: { a: 1 } }];
    expect(await batchKey("csv", r)).toBe(await batchKey("csv", r));
    expect(await batchKey("csv", r)).not.toBe(
      await batchKey("csv", [{ external_id: "2", data: {} }]),
    );
  });
});

describe("signed webhook", () => {
  const secret = "whsec_test_only",
    body = '{"entity":"student","records":[]}',
    now = 1_800_000_000;
  it("accepts a valid signature inside the window", () => {
    expect(
      verifyWebhook(secret, String(now), signWebhook(secret, String(now), body), body, now + 10),
    ).toBe(true);
  });
  it("rejects tampered body, wrong secret, stale timestamp, malformed header", () => {
    const sig = signWebhook(secret, String(now), body);
    expect(verifyWebhook(secret, String(now), sig, body + " ", now)).toBe(false);
    expect(verifyWebhook("other", String(now), sig, body, now)).toBe(false);
    expect(verifyWebhook(secret, String(now), sig, body, now + 301)).toBe(false);
    expect(verifyWebhook(secret, String(now), "sha256=zz", body, now)).toBe(false);
    expect(verifyWebhook(null, String(now), sig, body, now)).toBe(false);
  });
});

describe("google classroom stub", () => {
  it("namespaces external ids", () => {
    expect(mapCourse({ id: "42", name: "JSS1 Maths" }).external_id).toBe("gc:42");
  });
});
