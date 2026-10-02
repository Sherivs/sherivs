# AI Platform

> Status: Canonical (current features); Planned (platform agents).

## Current AI capabilities

| Feature | Module |
| --- | --- |
| Lesson-plan drafting | `lib/runtime/scholar/lesson-plan-ai.functions.ts` |
| Timetable generation | `lib/runtime/scholar/timetable.functions.ts` |
| Expense insights | `lib/runtime/scholar/expense-insights.functions.ts` |
| Digital twin summaries | `lib/runtime/scholar/digital-twin.functions.ts` |
| Portal assistants | `components/ai/**` (admin, teacher, student, parent) |

## Architecture

- Vercel AI SDK (`ai`) with `@ai-sdk/openai-compatible`.
- Gateway: `lib/ai-gateway.server.ts` -> `AI_GATEWAY_URL` / `AI_API_KEY`
  (server-side; keys never reach the client).
- Server functions scope the data an AI feature can access; AI never
  receives unrestricted database access.
- Outputs are validated before display/persistence.

## Governance

- Agent governance: `architecture/phase-07-ai-agent-system.md` (Phase 07
  specification) and the AI safety rules in `CONSTITUTION.md`.
- Human oversight required for high-impact AI actions.
- Platform agents (Planning, Academic, Operations, Finance, Communication,
  Analytics, Safety, Compliance, Research) are Planned under
  `architecture/phase-07-ai-agent-system.md` and
  `architecture/phase-26-ai-intelligence-layer.md`; none are implemented
  today.

