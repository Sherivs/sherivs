export const NOTIFY: string;
export const SERVICE_FILES: string[];
export interface FileEntry {
  file: string;
  body: {
    name: string;
    type: string;
    query: string;
    message: string;
    tags: string[];
    [k: string]: unknown;
  };
}
export function loadMonitors(): FileEntry[];
export function loadDashboards(): {
  file: string;
  body: Record<string, unknown> & { title: string };
}[];
export function monitorId(monitor: { tags?: string[] }): string | null;
export function lint(monitors: FileEntry[]): string[];
