export const DATADOG_SWITCH: "OBSERVABILITY_DATADOG_ENABLED";
export const DATADOG_EU_SITE: "datadoghq.eu";
export const DATADOG_EU_OTLP_BASE: string;
export const SERVICE_NAME: "sherivs-cron";
export const EXPORT_TIMEOUT_MS: number;

export interface TelemetryEnv {
  OBSERVABILITY_DATADOG_ENABLED?: string;
  DD_API_KEY?: string;
  DD_SITE?: string;
  DEPLOYMENT_ENVIRONMENT?: string;
  CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
  [key: string]: unknown;
}

export interface TelemetryConfig {
  readonly tracesUrl: string;
  readonly logsUrl: string;
  readonly resource: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
}

export interface RouteResult {
  route: string;
  path: string;
  status: number;
  ms: number;
  bytes: number;
  startedAt: number;
}

export function telemetryConfig(env: TelemetryEnv | undefined): TelemetryConfig | null;

export function createRecorder(
  env: TelemetryEnv | undefined,
  trigger: "scheduled" | "manual",
): {
  enabled: boolean;
  record(result: RouteResult): void;
  payloads(): { traces: unknown; logs: unknown } | null;
  flush(
    fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  ): Promise<void>;
};
