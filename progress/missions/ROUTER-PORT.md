# Model router port

Status: built (TypeScript only), draft PR. No vendor SDK, no network, no real model call.

- `frontend/src/lib/ai/model-router.ts`: `ModelProvider` adapter interface, `routeModelCall`. Eligibility is by data class (a provider is cleared up to a ceiling; restricted data never goes to a provider not cleared for it), task and priority. A ceiling cost cap is checked before any call. Input and output pass AIN-04 `screenText`; blocked input never reaches a provider, blocked output is refused, flagged output is returned as `flagged` for a person's decision. Failover stays inside the eligible set.
- Tests: 8 pass (`tests/unit/model-router.test.ts`).
- Not built: real adapters (each needs a founder decision, a data-protection review and a key held in Tumi's secret store); persistence of calls and spend (`wf_agent.daily_model_calls` and cost caps are still stored, not enforced); health checks and circuit breaking; per-organisation provider choice.
- Founder decision needed per provider: its `clearedUpTo` class. Default for any new adapter should be `public`.
