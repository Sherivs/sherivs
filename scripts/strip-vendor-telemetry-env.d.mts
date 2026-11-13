export function readEnvAssignments(text: string): Record<string, string>;

export function stripVendorTelemetryEnvText(
  text: string,
  options?: { forceAppEnv?: string; vercelEnv?: string },
): { text: string; removed: string[]; vendorTelemetry: boolean };
