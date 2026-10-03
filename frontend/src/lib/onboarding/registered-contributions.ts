/**
 * CoreGrid — V1-008: the onboarding composition root.
 *
 * Imports every domain provisioning contribution the platform composition
 * knows. Each adapter self-registers (fail-closed) at module load; adding a
 * domain to the platform onboarding surface is exactly one import here — the
 * engine and the server function remain domain-neutral.
 */
import "@/lib/onboarding/contributions/scholar-provisioning";

export {};