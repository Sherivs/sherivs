export interface CronRoute {
  name: string;
  path: string;
  setting: string;
  defaultEnabled: boolean;
  cadence: { everyMinutes: number } | { day: number; hour: number; minute: number };
  timeoutMs: number;
}

export interface CronEnv {
  CRON_SECRET?: string;
  TARGET_BASE_URL?: string;
  OBSERVABILITY_DATADOG_ENABLED?: string;
  DD_API_KEY?: string;
  DD_SITE?: string;
  DEPLOYMENT_ENVIRONMENT?: string;
  CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
  [setting: string]: string | { id?: string; tag?: string; timestamp?: string } | undefined;
}

export const ROUTES: CronRoute[];
export function isDue(route: CronRoute, scheduledTime: number | string | Date): boolean;
export function isEnabled(route: CronRoute, env: CronEnv): boolean;

declare const worker: {
  scheduled(
    controller: { scheduledTime: number | string | Date },
    env: CronEnv,
    context: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void>;
  fetch(
    request: Request,
    env: CronEnv,
    context?: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<Response>;
};

export default worker;
