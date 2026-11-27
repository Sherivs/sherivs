// AIN-04: evaluation and guardrail layer. Pure, no I/O, no model call. The database is the authority (wf_safety_* tables
// and guards, migration 20261117000995); this file restates the screening corpus, the normalization and the caps so the
// application can screen a text before it asks, and so a unit test fails when the two drift apart. It stores nothing and
// grants nothing: a check exists only through wf_safety_check_text, and model output stays untrusted whatever it says.

export type SafetyCategory = "injection" | "secret" | "pii" | "link" | "encoding";
export type SafetySeverity = "block" | "flag";
export type SafetyDirection = "input" | "output";
export type SafetyVerdict = "clean" | "flagged" | "blocked";

export type SafetyPattern = Readonly<{
  code: string;
  category: SafetyCategory;
  severity: SafetySeverity;
  appliesTo: SafetyDirection | "both";
  scan: "normalized" | "raw";
  /** Identical to the SQL string (PostgreSQL and JavaScript read it the same way). */
  regex: string;
}>;

const p = (
  code: string,
  category: SafetyCategory,
  appliesTo: SafetyPattern["appliesTo"],
  scan: SafetyPattern["scan"],
  regex: string,
): SafetyPattern => ({
  code,
  category,
  severity: category === "injection" || category === "secret" ? "block" : "flag",
  appliesTo,
  scan,
  regex,
});

/** wf_safety_pattern, in step with the migration's AIN04 PATTERN SEED (tests/unit/ain04-ai-guardrails.test.ts). */
export const SAFETY_PATTERNS: readonly SafetyPattern[] = Object.freeze([
  p(
    "injection.ignore_previous",
    "injection",
    "both",
    "normalized",
    String.raw`(ignore|disregard|forget|override|discard)( (all|any|the|your|my|these|those|of))* (previous|prior|above|earlier|preceding|former) (instruction|prompt|rule|direction|guideline|message|context|command)`,
  ),
  p(
    "injection.reveal_prompt",
    "injection",
    "both",
    "normalized",
    String.raw`((reveal|show|print|repeat|output|display|leak|disclose)( me)? (your|the) (system|hidden|secret|initial|original|developer) (prompt|instruction|message)|(reveal|leak|disclose) (your|the) (prompt|instruction))`,
  ),
  p(
    "injection.role_reassign",
    "injection",
    "both",
    "normalized",
    String.raw`(you are now (a|an) ([a-z-]+ )?(assistant|ai|bot|model|system|persona|character)|pretend (to be|you are) (a|an|the)|act as if you (are|were) (a|an|the)|your new (role|identity|persona) is)`,
  ),
  p(
    "injection.fake_role_marker",
    "injection",
    "both",
    "normalized",
    String.raw`(<\|?(im_start|im_end|endoftext|system|assistant)\|?>|\[/?inst\]|<<sys>>|### ?(system|instruction)s?:?|(^| )(system|developer) ?(prompt|message) ?:)`,
  ),
  p(
    "injection.jailbreak_mode",
    "injection",
    "both",
    "normalized",
    String.raw`(developer mode|dan mode|do anything now|jailbreak(ed)?( mode)?|no restrictions mode|unfiltered mode)`,
  ),
  p(
    "injection.bypass_controls",
    "injection",
    "both",
    "normalized",
    String.raw`(skip|bypass|disable|turn off|ignore|circumvent|override) (the |all |any )?(approval|human review|guardrail|safety (check|filter)|audit( log)?|autonomy (cap|limit)|spending (cap|limit)|consent check)s?`,
  ),
  p(
    "injection.exfiltrate",
    "injection",
    "both",
    "normalized",
    String.raw`(send|post|forward|email|upload|transmit|exfiltrate|leak)( \S+){0,8} (to|at) (https?://|\S+@\S+)`,
  ),
  p(
    "injection.tool_override",
    "injection",
    "both",
    "normalized",
    String.raw`(call|invoke|run|execute) (the )?(tool|function|api|command|action) .{0,60}(without|bypassing|skipping) (approval|review|confirmation|the broker)`,
  ),
  p(
    "injection.addressed_to_model",
    "injection",
    "both",
    "normalized",
    String.raw`((note|message|instruction)s? (to|for) (the )?(ai|assistant|model|agent|llm|chatbot)|(assistant|ai|model|agent|llm),? (you must|you should|you will|please) (now )?(ignore|send|forward|delete|transfer|approve|pay|reveal|disable))`,
  ),
  p("injection.tag_chars", "injection", "both", "raw", String.raw`[\U000e0000-\U000e007f]`),
  p(
    "secret.private_key",
    "secret",
    "both",
    "normalized",
    String.raw`-----begin [a-z ]{0,20}private key-----`,
  ),
  p("secret.cloud_key_id", "secret", "both", "normalized", String.raw`(akia|asia)[0-9a-z]{16}`),
  p(
    "secret.api_key",
    "secret",
    "both",
    "normalized",
    String.raw`((sk|rk|pk)_live_[0-9a-z]{8,}|sk-[0-9a-z_-]{20,})`,
  ),
  p(
    "secret.jwt",
    "secret",
    "both",
    "normalized",
    String.raw`eyj[0-9a-z_-]{8,}\.eyj[0-9a-z_-]{8,}\.[0-9a-z_-]{8,}`,
  ),
  p(
    "secret.connection_string",
    "secret",
    "both",
    "normalized",
    String.raw`(postgres(ql)?|mysql|mongodb(\+srv)?|redis)://[^ /@]+:[^ /@]+@`,
  ),
  p("secret.bearer_token", "secret", "both", "normalized", String.raw`bearer [0-9a-z._~+/=-]{24,}`),
  p("pii.email", "pii", "both", "normalized", String.raw`[0-9a-z._%+-]+@[0-9a-z.-]+\.[a-z]{2,}`),
  p(
    "pii.phone_ng",
    "pii",
    "both",
    "normalized",
    String.raw`(^|[^0-9])(\+?234|0)[ -]?[789][01][0-9][ -]?[0-9]{3}[ -]?[0-9]{4}($|[^0-9])`,
  ),
  p("pii.long_digit_id", "pii", "both", "normalized", String.raw`(^|[^0-9])[0-9]{11}($|[^0-9])`),
  p("link.external_url", "link", "output", "normalized", String.raw`https?://[^ ]+`),
  p(
    "encoding.invisible_chars",
    "encoding",
    "both",
    "raw",
    String.raw`[\u034f\u061c\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufe00-\ufe0f\ufeff\u00ad\U000e0000-\U000e007f]|[\u115f\u1160\u3164\uffa0]`,
  ),
  p("encoding.mixed_script", "encoding", "both", "raw", String.raw`[\u0370-\u03ff\u0400-\u04ff]`),
  p("encoding.long_blob", "encoding", "both", "normalized", String.raw`[0-9a-z+/_-]{120,}={0,2}`),
]);

/** Caps restated from the SQL functions wf_safety_*_cap / wf_safety_max_text_chars. */
export const SAFETY_MAX_TEXT_CHARS = 20_000;
export const SAFETY_RUN_CHECK_CAP = 200;
export const SAFETY_ORG_DAILY_CAP = 5_000;
export const SAFETY_EVAL_DAILY_CAP = 100;

/** Pattern text is shared with PostgreSQL, which writes an astral character as \U000e0000; JavaScript needs \u{e0000}. */
function compilePattern(regex: string): RegExp {
  const js = regex.replace(/\\U000([0-9a-f]{5})/g, "\\u{$1}");
  return new RegExp(js, js === regex ? "" : "u");
}

// Same character sets as wf_safety_norm / wf_safety_screen in the migration.
const FILLERS = String.raw`[\u0085\u115f\u1160\u1680\u180e\u200b-\u200d\u2060\u2800\u3164\ufeff\uffa0]`;
const INVISIBLE = String.raw`[\u034f\u061c\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufe00-\ufe0f\ufeff\u00ad\U000e0000-\U000e007f]`;
const LOOKALIKE_FROM = "ΟΑΕΙΚΝΡΤΥΧοαειμκνρτυχАЕОРСХУІЈЅаеорсхуіјѕ";
const LOOKALIKE_TO = "OAEIKNPTYXoaeimkvptuxAEOPCXYIJSaeopcxyijs";
const LOOKALIKE = new Map<string, string>(
  Array.from(LOOKALIKE_FROM, (c, i): [string, string] => [c, LOOKALIKE_TO[i]]),
);
const FILLERS_G = new RegExp(FILLERS, "gu");
const INVISIBLE_G = new RegExp(compilePattern(INVISIBLE).source, "gu");

/**
 * Mirror of wf_safety_norm: NFKC; filler characters become a space; invisible, joiner, selector, direction and tag
 * characters are removed; Greek and Cyrillic look-alikes are folded to Latin; lower-cased; whitespace collapsed.
 */
export function safetyNormalize(text: string): string {
  const stripped = text.normalize("NFKC").replace(FILLERS_G, " ").replace(INVISIBLE_G, "");
  return Array.from(stripped, (c) => LOOKALIKE.get(c) ?? c)
    .join("")
    .toLowerCase()
    .replace(/[ \t\n\r\f\v]+/g, " ")
    .trim();
}

export type SafetyScreen = Readonly<{ verdict: SafetyVerdict; codes: string[] }>;

const COMPILED = new Map<string, RegExp>(
  SAFETY_PATTERNS.map((x) => [x.code, compilePattern(x.regex)]),
);

/** Mirror of wf_safety_screen. Verdict blocked when a block pattern matches, else flagged when a flag pattern does. */
export function screenText(text: string, direction: SafetyDirection): SafetyScreen {
  const norm = safetyNormalize(text);
  // A filler inside a word: the same text with the fillers deleted instead of turned into a space.
  const joined = safetyNormalize(text.replace(FILLERS_G, ""));
  const hits = SAFETY_PATTERNS.filter(
    (x) =>
      (x.appliesTo === "both" || x.appliesTo === direction) &&
      (x.scan === "raw"
        ? text.search(COMPILED.get(x.code) as RegExp) >= 0
        : norm.search(COMPILED.get(x.code) as RegExp) >= 0 ||
          joined.search(COMPILED.get(x.code) as RegExp) >= 0),
  );
  const codes = hits.map((x) => x.code).sort();
  const blocked = hits.some((x) => x.severity === "block");
  return { verdict: codes.length === 0 ? "clean" : blocked ? "blocked" : "flagged", codes };
}

export type SafetyRefusal =
  "text_required" | "text_too_long" | "invalid_step" | "invalid_direction";

/** Why the database would refuse a check for reasons of shape alone (null = nothing wrong with the request). */
export function safetyCheckRefusal(
  step: string,
  direction: string,
  text: string,
): SafetyRefusal | null {
  if (!/^[a-z0-9][a-z0-9_.:-]{0,95}$/.test(step)) return "invalid_step";
  if (direction !== "input" && direction !== "output") return "invalid_direction";
  if (text.length === 0) return "text_required";
  if (text.length > SAFETY_MAX_TEXT_CHARS) return "text_too_long";
  return null;
}

/** Same bytes, same hash as the database: SHA-256 of the UTF-8 text, lower-case hex. Pass it to wf_safety_check_usable. */
export async function safetyTextSha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Model output is untrusted. Only a clean verdict is usable on its own; a flagged one needs a person's decision
 * (wf_safety_review_check) and a blocked one is never usable. Mirrors wf_safety_check_usable for the verdict part.
 */
export function outputUsable(
  verdict: SafetyVerdict,
  reviewDecision: "cleared" | "rejected" | null,
): boolean {
  if (verdict === "clean") return true;
  return verdict === "flagged" && reviewDecision === "cleared";
}
