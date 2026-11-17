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
  [setting: string]: string | undefined;
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
  fetch(request: Request, env: CronEnv): Promise<Response>;
};

export default worker;
