# ADR-128: Evaluation and Guardrail Layer in the Run Path, Provider-Free Slice (AIN-04)

| Field          | Value                                                                                                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status         | PROPOSED in the AIN-04 PR; nothing applied to any hosted database                                                                                                                                                                                                            |
| Date           | 2026-11-20                                                                                                                                                                                                                                                                   |
| Creator        | Claude Code agent, mission AIN-04 (provenance id A-001, issue #478); AI-generated                                                                                                                                                                                            |
| Version target | V1 organizational workflows, Phase 2 (AI-native core)                                                                                                                                                                                                                        |
| Depends on     | [ADR-125](ADR-125_AIN01_AGENTS_AS_ENGINE_ACTORS.md) (closed AI route), [ADR-126](ADR-126_AIN02_AUTONOMY_SCALE_AND_PROMOTION_GATE.md) (autonomy caps, untouched), [ADR-127](ADR-127_AIN03_TENANT_MEMORY_AND_CONTEXT_SCOPES.md) (stacked on #477), WF-07 (`workflows.approve`) |
| Migration      | `database/supabase/migrations/20261117000995_sherivs_ain04_evaluation_guardrail_layer.sql` (`..000990` is AIN-03; `..001000` is used by open PRs; the founder confirms the number before apply)                                                                              |
| Rollback       | `database/supabase/rollbacks/20261117000995_sherivs_ain04_evaluation_guardrail_layer.sql`                                                                                                                                                                                    |

## Provenance

| Item                   | Source                                                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement            | Issue #478; the AIN-04 roadmap entry ("evaluation and guardrail layer in the run path: eval suites, prompt-injection corpus, output trust") in the workflow hand-off, Part B section 5                                           |
| Existing work checked  | No `wf_safety*` objects and no open PR for the capability (2026-11-20). `wf_template.eval_suite` (WF-03) is a name column only. ENGINE-13 `eval_suites` rows and AIN-02 `wf_autonomy_evidence` are separate and were not changed |
| Open founder decisions | 3 (AI route) is respected: no model is called and no tenant content reaches one; suites about a real agent or model are NOT built. 7 (minors) is untouched: the screener flags personal-data shapes but decides no lawful basis  |

## Context

The engine will gain AI steps (WF-11) once the founder decides the AI route (decision 3). Before any model output can
enter a run, the run path needs three things that need no model at all: a screening corpus for untrusted text (prompt
injection, secrets, personal-data shapes, tricks of encoding), a test that proves the corpus does what it claims, and a
rule that model output is untrusted until it is screened and, when flagged, decided by a person. This mission builds those
three, deterministic and inside the database, so they exist, are tested and cannot be skipped before the first model call
is ever allowed.

## Decision

1. **A reviewed corpus** (`wf_safety_pattern`): 23 patterns in five categories. Injection and secret shapes can only
   **block** and the rest only **flag** (a CHECK, so editing the data cannot soften an injection pattern). All patterns
   are lower-case and use syntax PostgreSQL and JavaScript read the same way; `frontend/src/lib/workflow/ai-guardrails.ts`
   restates them and a unit test ties the two files row by row.
2. **One deterministic screener** (`wf_safety_screen`): NFKC, invisible and direction-control characters removed,
   lower-cased, whitespace collapsed; then every pattern that applies to the direction (`input` is text on its way to a
   model, `output` is text from one). Verdict `blocked` when a block pattern matches, `flagged` when only flag patterns
   do, else `clean`. Two patterns scan the raw text so the tricks the normalization removes are themselves reported.
3. **An eval suite for the screener** (`wf_safety_eval_suite`, `wf_safety_eval_case`): 63 cases, injection and
   obfuscation variants, secrets built from pieces (no secret-shaped literal exists in the repository), personal-data
   shapes, and eleven cases that must stay clean (hard negatives). Every pattern must be expected by at least one case; an
   uncovered pattern is a failed check. The only suite kind is `screener`: a suite about a real agent or model needs the
   AI route and is NOT here.
4. **Runs are computed in the database and recorded append-only** (`wf_safety_eval_run`). The insert guard recomputes
   the whole result from the corpus and refuses a row that does not match, so neither a faulty function nor a
   hand-opened write window can record a pass the corpus does not earn. 100 runs per day at most; a run for an unchanged
   corpus is reused for an hour. The migration runs the suite once and aborts if it does not pass.
5. **Fail closed.** The screener is trusted only while the latest run for the CURRENT hash of the patterns and cases
   passed (`wf_safety_verified`). Edit a pattern or a case without re-running the suite and every check returns
   `blocked` with the code `guard.unverified`, and every earlier clean check stops being usable.
6. **Output trust in the run path.** `wf_safety_check_text(run, step, direction, text)` takes an ACTIVE run (the
   organization comes from the run, never from the caller), screens the text and writes one append-only ledger row
   (`wf_safety_check`: verdict, codes, SHA-256, length, corpus hash; never the text) and one `audit_chain` entry. Only a
   `clean` verdict is usable. Limits in SQL: 20000 characters per text, 200 checks per run, 5000 per organization per 24
   hours. With workflows off for the organization nothing is written.
7. **A person decides flagged output** (`wf_safety_review_check`): needs `workflows.approve` in the person's own
   organization; the person who started the run cannot decide its output (checked in the guard, so a bypassed function
   still cannot skip it); one decision per check; a `blocked` or `clean` check cannot be reviewed, so a blocked output can
   never be cleared.
8. **Usable means this exact text** (`wf_safety_check_usable(check, text_sha256, direction)`): true only when the hash matches the
   checked text, the check was made against the current verified corpus, the organization still has workflows on, and the
   verdict is `clean` or `flagged` and cleared. Anything else, including an unknown id, is false.
9. **Nothing here raises autonomy.** No AIN-04 function reads or writes autonomy, agents, memory content or the AI route
   (a harness check searches the function sources). A cleared output is still subject to the AIN-02 caps and the broker.

## Service role trust model (stated honestly)

The service role is the engine. It has SELECT on the six tables (the ledgers hold hashes, codes and counts) and nothing
else; it executes exactly four functions (`wf_safety_run_eval`, `wf_safety_check_text`, `wf_safety_review_check`,
`wf_safety_check_usable`) and none of the internal ones. What SQL guarantees: nobody writes a ledger except through those
functions; the organization, the run state, the caps, the authority and the separation of duties are decided in SQL; an
eval run cannot claim what the corpus does not earn; a person's decision cannot be changed. What SQL cannot guarantee:
the text. The service role chooses which text it submits and SQL stores only its hash, so a faulty or hostile engine could
screen one text and use another. `wf_safety_check_usable` closes the honest path (the consumer passes the hash of the text
it will use) and the ledger makes a mismatch detectable afterwards, but the hash is supplied by the same trusted caller.
The same limit holds for the corpus itself: it is reviewed data changed only by a migration, and the fail-closed link
makes an unreviewed edit visible rather than impossible for the database owner.

## Assumptions (open)

- The patterns, caps (20000 characters, 200 per run, 5000 per day, 100 suite runs per day) and the one-hour reuse window
  are engineering defaults for the founder to ratify.
- A pattern corpus catches known shapes. It does not stop a determined attacker (paraphrase, another language, split
  across fields, homoglyphs outside Cyrillic); it is one layer. Greek letters are not flagged (they appear in maths).
- Who may clear flagged output (v1: `workflows.approve`, never the run's starter) is a founder decision (4).

## Accepted limitations and follow-ups

- Nothing calls the four functions yet: the run path (WF-11 AI steps, the broker) and the scheduler route that would run
  the suite after a corpus change are follow-ups, as for AIN-01 to AIN-03. No UI.
- No suite exists for an agent's or a model's behaviour (needs decision 3). AIN-02 `wf_autonomy_evidence` remains
  caller-asserted; this mission does not change it. Only the screener's own results are computed in the database.
- AIN-03 memory notes are not screened on write (AIN-03 is unchanged); a later reviewed change can call the screener there.
- The starter of the run is copied onto the check row when the check is made (`run_started_by`), so the "starter cannot
  review" rule still holds after run retention deletes the run. A run with no person starter has none to exclude.
- PostgreSQL and JavaScript may differ on a newer Unicode normalization; the harness proves PostgreSQL, the unit test
  proves JavaScript, against the same cases.
- The ledgers are not purged (hashes and codes only); a retention rule is a follow-up.

## Review round 1 (2026-11-26)

The independent review of #479 (APPROVE WITH FIXES, no blocking item) led to four changes:

1. **Starter after retention.** `wf_safety_check.run_started_by` is set from the run when the check is made and the
   review guard compares against it instead of looking the run up (above).
2. **A harder screener.** Blank-looking fillers (NEL, Ogham space, Mongolian vowel separator, Braille blank, Hangul
   fillers, zero-width spaces and joiners) turn into a space; joiners, variation selectors, the combining grapheme joiner,
   Arabic letter mark, Khmer inherent vowels, Mongolian free variation selectors and tag characters are removed; Greek
   and Cyrillic look-alike letters are folded to Latin. `wf_safety_screen` matches the normalized text and a second form
   with the fillers deleted (a filler inside a word). Tag characters (U+E0000 to U+E007F) block on their own
   (`injection.tag_chars`: they can carry an invisible instruction). The raw invisible-character and look-alike-script
   patterns now cover the new ranges and Greek. Sixteen new eval cases cover each family. This is still a deny-list of
   known shapes: a paraphrase or another language is not caught (see limitations).
3. **The screener's code is part of "verified".** The suite hash includes the definitions of `wf_safety_norm` and
   `wf_safety_screen`, so replacing either with different code un-verifies every earlier run until a new run passes.
4. **A usable answer is tied to the direction** the text was checked in: `wf_safety_check_usable` takes the direction
   and is false for any other.

Left as recorded, not changed: the text hash is a plain SHA-256 (a short flagged text such as an email or phone number
can be guessed from it by a member who can read the ledger; an HMAC with a server pepper is a follow-up); the suite hash
joins fields with `|` and newlines (an ambiguity only an owner-edited corpus could use); reviewer-typed reasons are kept
in `wf_safety_review` but not written to the audit chain.

## Consequences

- With `wf_ai_route_approved()` false no AI step can exist (AIN-01), so none of this screens a model's output yet; it
  screens whatever text the engine submits, and it is ready.
- `wf12-default-privileges` lists four more functions the service role may execute. The AIN-04 default-privileges CI step
  re-applies AIN-04 under Supabase default privileges and asserts the exact ACLs.
- The rollback refuses while a check or review row exists; remove them deliberately first.
