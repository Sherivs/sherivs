export interface DpoDesignation {
  name: string;
  title: string;
  organisation: string;
  effective_from: string;
  effective_until: string;
  is_interim: boolean;
}

export function renderDpoDesignation(designation: DpoDesignation, asOf?: Date): string;
export function renderDpoOverview(
  document: string,
  designation: DpoDesignation,
  asOf?: Date,
): string;
