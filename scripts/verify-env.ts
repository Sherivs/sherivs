/**
 * CoreGrid environment verification.
 * Usage: npm run verify:env
 * Validates required environment variables and detects server-only secrets
 * accidentally exposed via VITE_ prefix.
 */
import { classifyEnvironment, environmentIssues } from "../frontend/src/lib/env";

const env = process.env as Record<string, string | undefined>;
const environment = classifyEnvironment(env.NODE_ENV ?? env.APP_ENV);
const issues = environmentIssues(env, environment);

if (issues.length > 0) {
  console.error(`[FAIL] Environment "${environment}" has issues:`);
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}

console.log(`[PASS] Environment "${environment}" is valid.`);
