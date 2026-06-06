import type { ExportProfile } from "./types";

const CATEGORY_ORDER = ["missing_elements", "contradictions", "vague_claims", "anomalies"] as const;

export const CATEGORY_LABELS: Record<(typeof CATEGORY_ORDER)[number], string> = {
  missing_elements: "Missing Elements",
  contradictions: "Contradictions",
  vague_claims: "Vague Claims",
  anomalies: "Anomalies",
};

export { CATEGORY_ORDER };

export function formatRequirementsLabel(
  profile: ExportProfile | null,
  customRequirements?: string | null,
): { label: string; detail?: string } {
  const snippet = customRequirements
    ? customRequirements.length > 120
      ? `${customRequirements.slice(0, 120).trimEnd()}…`
      : customRequirements
    : undefined;

  if (profile) {
    const profileLabel = [profile.name, profile.seniority_level].filter(Boolean).join(" — ");
    return customRequirements
      ? { label: `${profileLabel} + custom requirements`, detail: snippet }
      : { label: profileLabel };
  }
  if (customRequirements) {
    return { label: "Custom requirements", detail: snippet };
  }
  return { label: "Unknown profile" };
}

export function exportFilenameStem(analysisId: string, createdAt: string): string {
  const date = new Date(createdAt).toISOString().slice(0, 10);
  return `analysis-${analysisId}-${date}`;
}

export function formatCreatedDate(createdAt: string): string {
  return new Date(createdAt).toISOString().slice(0, 10);
}
