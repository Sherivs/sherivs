# ADR-NNN: Title in Plain Language (condition/gap identifier, e.g. COND-XXX / J-XXX)

|| Field | Value |
||---|---|
|| Status | PROPOSED (operator rules; name the human-approval gate this ADR waits on) |
|| Date | YYYY-MM-DD |
|| Author | ROLE NAME (TEAM/MISSION ID) |
|| Mission | <mission id> (<squad>; <role>) |
|| Capabilities | <V1CAP ids owned> [<additional capability consumed, not owned>] |
|| Supersedes-in-part | None / [ADR-NNN_TITLE.md](./ADR-NNN_TITLE.md) — state exactly what changes and what stands unchanged |
|| Cites | <the files, JSON registers, migrations (file:line), and AGENTS/Constitution sections the decision rests on — every load-bearing claim carries a citation> |
|| Minimal ownership artifact | <the one artifact this ADR owns, if it authors one; otherwise "This ADR only — a decision artifact"> |

> Numbering: sequential (`ADR-015` is next free in `architecture/adr/`). Filename: `ADR-NNN_SNAKE_CASE_TITLE.md`. Never renumber, rewrite, or delete an existing ADR (AGENTS §39) — a new ADR supersedes; it does not edit its predecessor. Update `INDEX.md` in the same change.

## Context

The collision, gap, or deferral this ADR resolves, stated as fact with citations. Name the unresolved entries (COND-xxx / J-xxx / GAP-xxx / UNKNOWN-x of a parent ADR), the structural facts that constrain the answer, and what no existing artifact yet rules. Do not argue the decision here — record the problem.

## Options

### Option 1 — <name> (rejected / retained as future hardening)

What it is, in one or two sentences.

- **Consequences:** both sides, honestly — what it buys AND its costs/risks (security, availability, audit, blast radius). Cite the law or structural fact that grounds each rejection ground.

### Option 2 — <name> (rejected / retained)

Same shape. Every rejected option names its rejection grounds explicitly.

### Option N — <name> (ruled)

Same shape, including the honest costs of the winning option. A ruling that hides its costs violates the honesty law (AGENTS §42).

## Recommendation (decision)

The ruled option, stated in one bolded paragraph, with the governing constraints the implementing mission must honor (fail-closed semantics, citation duties, invariants to prove). Then, if the decision leaves an exposure open:

### Explicit residual risk (stated, bounded, owned — not hidden)

- **The residual risk:** what remains true after the ruling, and its bound.
- **The sharpest instance:** where the bound bites hardest.
- **The accepted rationale:** why the bound is lawful and implementable-now.
- **Owner of the residual risk:** the phase/capability that owns it, and what it must report and to whom.

## Consequences (summary)

- **Positive:** what the ruling unblocks and makes machine-checkable.
- **Negative / obligations:** the compliance-critical duties the ruling creates (contracts, automation, disclosures, test invariants).
- **For the wave/program specifically:** which missions or teams consume this ruling and how.

## Golden Questions

- **WHO?** Which phase/mission owns what this ADR rules, who owns residual risk, and who rules it.
- **WHAT?** The decision in one sentence.
- **WHERE?** Where the ruling lives (this file), where its numbers live, where its mechanics and checks live.
- **WHY?** The gap/collision (with identifiers) that made the ruling necessary.
- **UNDER WHICH POLICY?** The AGENTS/Constitution sections, parent ADRs, and registers the ruling binds or is bound by.

## UNKNOWNs

The open items this ADR deliberately does not resolve: operator gates not yet passed, capabilities not yet evidenced, mechanical enforcement not yet built, interactions with other open rulings. Each UNKNOWN names who resolves it and what would close it. An ADR that hides its UNKNOWNs is a defect, not a decision.