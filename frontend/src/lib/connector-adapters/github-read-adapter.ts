/**
 * GitHub read adapter (ENGINE-06, ADR-084): the first connector, read-only.
 *
 * It performs only the `github.read` tool (T0) and only GET requests to
 * api.github.com. It cannot write, merge, comment or change settings: there is
 * no code path that issues anything but a GET, and the egress wrapper blocks any
 * other host. Responses are reduced to an allowlist of fields; nothing else the
 * API returns is kept.
 */
import { z } from "zod";
import type {
  AdapterCall,
  AdapterErrorCode,
  AdapterResult,
  ConnectorAdapter,
} from "./adapter-contract";
import { allowlistedHttp, EgressBlockedError } from "./http-egress";

export const GITHUB_API_HOST = "api.github.com";
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;
const MAX_BODY = 512 * 1024;
const TIMEOUT_MS = 8_000;

const argsSchema = z
  .object({
    operation: z.enum(["get_repo", "list_pull_requests", "get_pull_request", "list_commits"]),
    owner: z.string().regex(NAME),
    repo: z.string().regex(NAME),
    number: z.number().int().min(1).max(1_000_000).optional(),
    perPage: z.number().int().min(1).max(30).optional(),
  })
  .strict();

const SUBJECT = /^github:([A-Za-z0-9._-]{1,100})\/([A-Za-z0-9._-]{1,100})$/;

/** A playbook step carries only an opaque subject reference: `github:owner/repo`. */
function normaliseArgs(args: Readonly<Record<string, unknown>>) {
  if (typeof args["operation"] === "string") return argsSchema.safeParse(args);
  const subject = typeof args["subjectRef"] === "string" ? SUBJECT.exec(args["subjectRef"]) : null;
  if (!subject) return argsSchema.safeParse({ operation: "" });
  return argsSchema.safeParse({
    operation: "list_pull_requests",
    owner: subject[1],
    repo: subject[2],
  });
}

const cut = (v: unknown, n: number): string | null =>
  typeof v === "string" ? v.slice(0, n) : null;
const pick = (o: unknown): Record<string, unknown> =>
  o && typeof o === "object" ? (o as Record<string, unknown>) : {};

function summarise(op: string, json: unknown): unknown {
  const arr = Array.isArray(json) ? json : [json];
  switch (op) {
    case "get_repo": {
      const r = pick(json);
      return {
        fullName: cut(r["full_name"], 200),
        private: r["private"] === true,
        defaultBranch: cut(r["default_branch"], 100),
        openIssues: typeof r["open_issues_count"] === "number" ? r["open_issues_count"] : null,
        pushedAt: cut(r["pushed_at"], 40),
      };
    }
    case "list_pull_requests":
    case "get_pull_request":
      return arr.slice(0, 30).map((p) => {
        const x = pick(p);
        return {
          number: typeof x["number"] === "number" ? x["number"] : null,
          title: cut(x["title"], 200),
          state: cut(x["state"], 20),
          draft: x["draft"] === true,
          author: cut(pick(x["user"])["login"], 100),
          head: cut(pick(x["head"])["ref"], 200),
          base: cut(pick(x["base"])["ref"], 200),
          updatedAt: cut(x["updated_at"], 40),
          url: cut(x["html_url"], 300),
        };
      });
    default:
      return arr.slice(0, 30).map((c) => {
        const x = pick(c);
        const commit = pick(x["commit"]);
        return {
          sha: cut(x["sha"], 7),
          message: cut(String(commit["message"] ?? "").split("\n")[0], 120),
          author: cut(pick(x["author"])["login"], 100),
          date: cut(pick(commit["author"])["date"], 40),
        };
      });
  }
}

function pathFor(a: z.infer<typeof argsSchema>): string | null {
  const base = `/repos/${encodeURIComponent(a.owner)}/${encodeURIComponent(a.repo)}`;
  const per = `per_page=${a.perPage ?? 10}`;
  switch (a.operation) {
    case "get_repo":
      return base;
    case "list_pull_requests":
      return `${base}/pulls?state=open&${per}`;
    case "get_pull_request":
      return a.number === undefined ? null : `${base}/pulls/${a.number}`;
    case "list_commits":
      return `${base}/commits?${per}`;
  }
}

const STATUS_CODE: Readonly<Record<number, AdapterErrorCode>> = {
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  429: "rate_limited",
};

export const githubReadAdapter: ConnectorAdapter = {
  connector: "github",
  tools: ["github.read"],
  async execute(call: AdapterCall): Promise<AdapterResult> {
    if (call.tool.id !== "github.read" || call.tool.direction !== "read") {
      return { outcome: "failed", code: "unsupported_operation" };
    }
    const parsed = normaliseArgs(call.args);
    if (!parsed.success) return { outcome: "failed", code: "invalid_args" };
    const path = pathFor(parsed.data);
    if (!path) return { outcome: "failed", code: "invalid_args" };

    const http = allowlistedHttp(call.http, [GITHUB_API_HOST]);
    let res;
    try {
      res = await http.request({
        method: "GET",
        url: `https://${GITHUB_API_HOST}${path}`,
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "sherivs-connector",
          "X-GitHub-Api-Version": "2022-11-28",
          Authorization: `Bearer ${call.secret}`,
        },
        timeoutMs: TIMEOUT_MS,
      });
    } catch (e) {
      if (e instanceof EgressBlockedError) return { outcome: "failed", code: "egress_blocked" };
      return { outcome: "failed", code: "timeout" };
    }
    if (res.status >= 300) {
      return {
        outcome: "failed",
        code: STATUS_CODE[res.status] ?? (res.status >= 500 ? "upstream_error" : "bad_response"),
      };
    }
    if (res.bodyText.length > MAX_BODY) return { outcome: "failed", code: "bad_response" };
    let json: unknown;
    try {
      json = JSON.parse(res.bodyText);
    } catch {
      return { outcome: "failed", code: "bad_response" };
    }
    return { outcome: "succeeded", summary: summarise(parsed.data.operation, json) };
  },
};
