import { describe, expect, it } from "vitest";
import { isPublicAddress, assertPublicHttps } from "@/lib/integrations-hub/http.server";
import { fedena, xmlRecords } from "@/lib/integrations-hub/connectors/fedena";
import { moodle } from "@/lib/integrations-hub/connectors/moodle";
import { oneroster } from "@/lib/integrations-hub/connectors/oneroster";
import { runIntegrationWorker, type WorkerDb } from "@/lib/integrations-hub/runtime.server";
import type { CredentialVault } from "@/lib/credential-vault/vault.server";
import type { PullContext } from "@/lib/integrations-hub/sdk";

type Call = { url: string; init?: RequestInit };
function fakeFetch(routes: [RegExp, (u: string) => Response][]) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = `${url} ${typeof init?.body === "string" ? init.body : ""}`;
    for (const [re, h] of routes) if (re.test(key)) return h(url);
    return new Response("nf", { status: 404 });
  };
  return { f, calls };
}
const json = (o: unknown) =>
  new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
const ctx = (p: Partial<PullContext>): PullContext => ({
  entity: "student",
  cursor: null,
  secret: null,
  config: { base_url: "https://sis.example.sch.ng/" },
  fetch: async () => new Response(""),
  ...p,
});

describe("SSRF guard", () => {
  it("classifies private, loopback, link-local, metadata and mapped addresses as non-public", () => {
    for (const ip of [
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.5.4",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "fec0::1",
      "64:ff9b::7f00:1",
      "64:ff9b::a9fe:a9fe",
      "64:ff9b:1::1",
      "2002:7f00:1::",
      "2002:a9fe:a9fe::",
      "2001:0:1::1",
      "100::1",
      "192.0.0.8",
      "192.88.99.1",
    ])
      expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of ["8.8.8.8", "102.89.1.10", "2001:4860:4860::8888", "64:ff9b::808:808"])
      expect(isPublicAddress(ip), ip).toBe(true);
  });
  it("rejects http, credentials-in-URL and hosts resolving to private IPs", async () => {
    await expect(
      assertPublicHttps("http://x.example", async () => [{ address: "8.8.8.8" }]),
    ).rejects.toThrow();
    await expect(
      assertPublicHttps("https://u:p@x.example", async () => [{ address: "8.8.8.8" }]),
    ).rejects.toThrow();
    await expect(
      assertPublicHttps("https://x.example", async () => [
        { address: "8.8.8.8" },
        { address: "10.1.1.1" },
      ]),
    ).rejects.toThrow();
    await expect(
      assertPublicHttps("https://x.example/a", async () => [{ address: "8.8.8.8" }]),
    ).resolves.toBeInstanceOf(URL);
  });
});

describe("Fedena", () => {
  it("parses XML safely and refuses DOCTYPE", () => {
    expect(
      xmlRecords(
        "<students><student><id>4</id><first_name>Ada &amp; Co</first_name><admission_no><![CDATA[A/1]]></admission_no></student></students>",
        "student",
      ),
    ).toEqual([{ id: "4", first_name: "Ada & Co", admission_no: "A/1" }]);
    expect(() =>
      xmlRecords(
        '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><student><id>&e;</id></student>',
        "student",
      ),
    ).toThrow(/DOCTYPE/);
  });
  it("gets a token, pages by id_gt and maps students", async () => {
    const { f, calls } = fakeFetch([
      [/oauth\/token /, () => json({ access_token: "T1" })],
      [
        /students\?search\[id_gt\]=0 /,
        () =>
          new Response(
            "<students><student><id>7</id><admission_no>SS1-007</admission_no><first_name>Ada</first_name><last_name>Obi</last_name><gender>F</gender><batch_name>JSS1 A</batch_name></student></students>",
          ),
      ],
    ]);
    const secret = JSON.stringify({
      client_id: "c",
      client_secret: "s",
      username: "u",
      password: "p",
    });
    const r = await fedena.pull!(ctx({ fetch: f, secret }));
    expect(r.cursor).toBe("7");
    expect(r.records[0]).toEqual({
      external_id: "fedena:SS1-007",
      data: expect.objectContaining({
        admission_number: "SS1-007",
        gender: "female",
        class_name: "JSS1 A",
      }),
    });
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe(
      'Token token="T1"',
    );
    await expect(fedena.pull!(ctx({ fetch: f, secret: null }))).rejects.toThrow(/not connected/);
  });
});

describe("Moodle", () => {
  it("POSTs wstoken (not in URL) and returns a course-index cursor", async () => {
    const { f, calls } = fakeFetch([
      [
        /core_course_get_courses/,
        () =>
          json([
            { id: 1, shortname: "site", format: "site" },
            { id: 5, shortname: "MTH-JSS1", fullname: "Maths JSS1" },
          ]),
      ],
      [
        /core_enrol_get_enrolled_users/,
        () =>
          json([
            {
              id: 9,
              firstname: "Ada",
              lastname: "Obi",
              email: "ada@x.ng",
              idnumber: "SS1-007",
              roles: [{ shortname: "student" }],
            },
          ]),
      ],
    ]);
    const r = await moodle.pull!(
      ctx({ entity: "student", fetch: f, secret: JSON.stringify({ token: "W" }) }),
    );
    expect(
      calls.every((c) => !c.url.includes("wstoken") && String(c.init?.body).includes("wstoken=W")),
    ).toBe(true); // token never in URL/logs
    expect(r).toMatchObject({ cursor: "1", done: true });
    expect(r.records.length).toBeGreaterThan(0);
    expect(r.records[0].external_id).toMatch(/^moodle:/);
  });
  it("surfaces Moodle exceptions returned with HTTP 200", async () => {
    const { f } = fakeFetch([
      [
        /./,
        () =>
          json({ exception: "webservice_access_exception", message: "Access control exception" }),
      ],
    ]);
    await expect(
      moodle.pull!(ctx({ entity: "class", fetch: f, secret: JSON.stringify({ token: "W" }) })),
    ).rejects.toThrow();
  });
});

describe("OneRoster", () => {
  it("client-credentials token, delta filter from cursor, skips tobedeleted", async () => {
    const { f, calls } = fakeFetch([
      [/token /, () => json({ access_token: "B" })],
      [
        /\/users\?/,
        () =>
          json({
            users: [
              {
                sourcedId: "u1",
                status: "active",
                dateLastModified: "2026-10-20T10:00:00Z",
                role: "student",
                givenName: "Ada",
                familyName: "Obi",
                identifier: "SS1-007",
              },
              {
                sourcedId: "u2",
                status: "tobedeleted",
                dateLastModified: "2026-10-21T10:00:00Z",
                role: "student",
                givenName: "X",
                familyName: "Y",
              },
            ],
          }),
      ],
    ]);
    const r = await oneroster.pull!(
      ctx({
        entity: "student",
        cursor: "0|2026-10-01T00:00:00Z|2026-10-01T00:00:00Z",
        fetch: f,
        secret: JSON.stringify({ client_id: "c", client_secret: "s" }),
        config: { base_url: "https://or.example", token_url: "https://or.example/token" },
      }),
    );
    expect(decodeURIComponent(calls[1].url).replace(/\+/g, " ")).toContain(
      "dateLastModified>'2026-10-01T00:00:00Z'",
    );
    expect(r.records.map((x) => x.external_id)).toEqual(["or:u1"]);
    expect(r.done).toBe(true);
    expect(r.cursor).toBe("0|2026-10-21T10:00:00Z|2026-10-21T10:00:00Z");
  });
});

describe("worker runtime", () => {
  function fakeDb(integration: Record<string, unknown>, jobs: unknown[]) {
    const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
    const db: WorkerDb = {
      rpc: async (fn, args) => {
        rpcs.push({ fn, args });
        if (fn === "integration_claim_due_jobs") return { data: jobs, error: null };
        if (fn === "integration_outbox_claim") return { data: [], error: null };
        return { data: { ok: true }, error: null };
      },
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: integration, error: null }) }),
        }),
      }),
    };
    return { db, rpcs };
  }
  const vault = {
    withCredential: async (
      _o: string,
      _p: string,
      _n: string,
      fn: (s: string) => Promise<unknown>,
    ) => fn(JSON.stringify({ client_id: "c", client_secret: "s" })),
  } as unknown as CredentialVault;
  const integ = {
    id: "i1",
    school_id: "S1",
    connector_key: "oneroster",
    status: "active",
    config: { base_url: "https://or.example", token_url: "https://or.example/token" },
    credential_provider: "integration.oneroster",
    credential_name: "i1",
  };

  it("pulls, ingests with a deterministic idempotency key and stores the cursor", async () => {
    const { db, rpcs } = fakeDb(integ, [
      {
        id: "j1",
        integration_id: "i1",
        school_id: "S1",
        entity: "student",
        direction: "inbound",
        cursor: null,
      },
    ]);
    const { f } = fakeFetch([
      [/token /, () => json({ access_token: "B" })],
      [
        /users/,
        () =>
          json({
            users: [
              {
                sourcedId: "u1",
                status: "active",
                dateLastModified: "2026-10-20T10:00:00Z",
                role: "student",
                givenName: "A",
                familyName: "B",
              },
            ],
          }),
      ],
    ]);
    const rep = await runIntegrationWorker({ db, vault, fetch: f });
    const ing = rpcs.filter((r) => r.fn === "integration_ingest");
    expect(rep).toMatchObject({ jobs: 1, records: 1, jobErrors: 0 });
    expect(ing[0].args).toMatchObject({
      p_integration: "i1",
      p_entity: "student",
      p_trigger: "schedule",
    });
    expect(String(ing[0].args.p_idempotency_key)).toMatch(/^pull-[0-9a-f]{40}$/);
    expect(rpcs.find((r) => r.fn === "integration_job_done")?.args).toMatchObject({
      p_job: "j1",
      p_error: null,
    });
  });
  it("never runs a job whose school does not match the integration, and records connector errors", async () => {
    const a = fakeDb(integ, [
      {
        id: "j1",
        integration_id: "i1",
        school_id: "OTHER",
        entity: "student",
        direction: "inbound",
        cursor: null,
      },
    ]);
    await runIntegrationWorker({
      db: a.db,
      vault,
      fetch: async () => {
        throw new Error("must not fetch");
      },
    });
    expect(a.rpcs.some((r) => r.fn === "integration_ingest")).toBe(false);
    const b = fakeDb(integ, [
      {
        id: "j2",
        integration_id: "i1",
        school_id: "S1",
        entity: "student",
        direction: "inbound",
        cursor: "x",
      },
    ]);
    const rep = await runIntegrationWorker({
      db: b.db,
      vault,
      fetch: async () => new Response("no", { status: 401 }),
    });
    expect(rep.jobErrors).toBe(1);
    expect(String(b.rpcs.find((r) => r.fn === "integration_job_done")?.args.p_error)).toMatch(
      /401/,
    );
  });
});
