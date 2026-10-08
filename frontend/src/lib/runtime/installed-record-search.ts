/**
 * Record searches published by installed runtimes for the platform command palette.
 * The palette never knows a runtime's tables; it asks each provider, and only when the
 * member's authorized navigation contains the provider's destination.
 */
import type { RecordSearchProvider } from "@/lib/platform/command-registry";
import { SCHOLAR_LEARNER_SEARCH } from "./scholar-record-search";

export const INSTALLED_RECORD_SEARCH_PROVIDERS: readonly RecordSearchProvider[] = [SCHOLAR_LEARNER_SEARCH];
