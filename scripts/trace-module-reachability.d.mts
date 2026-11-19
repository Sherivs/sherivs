export const DEFAULT_MODULES: string[];
export const LIB_DIR: string;
export const QUARANTINE_DIR: string;

export type ImportGraph = Map<string, string[]>;

export interface TraceResult {
  module: string;
  exists: boolean;
  files: string[];
  status: "REACHABLE" | "UNREACHABLE" | "MISSING";
  chain: string[] | null;
  directImporters: string[];
  directTestImporters: string[];
  transitiveImporters: string[];
  transitiveTestImporters: string[];
}

export function extractSpecifiers(source: string): string[];
export function isTestFile(file: string): boolean;
export function isEntryFile(file: string): boolean;
export function resolveSpecifier(
  fromFile: string,
  specifier: string,
  fileSet: Set<string>,
): string | null;
export function buildGraph(sources: Record<string, string>): ImportGraph;
export function moduleFiles(name: string, files: string[], libDir?: string): string[];
export function traceModule(
  name: string,
  imports: ImportGraph,
  options?: { isEntry?: (file: string) => boolean; libDir?: string },
): TraceResult;
export function findQuarantineImporters(
  imports: ImportGraph,
  quarantineDir?: string,
): Array<{ file: string; imports: string }>;
export function readRepositorySources(root: string): Record<string, string>;
export function formatResult(result: TraceResult): string;
