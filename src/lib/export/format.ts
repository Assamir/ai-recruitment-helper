import type { ExportProfile } from "./types";
import { formatRequirementsLabel as formatRequirementsLabelShared } from "@/lib/analysis/format-requirements";

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
): ReturnType<typeof formatRequirementsLabelShared> {
  return formatRequirementsLabelShared(profile, customRequirements);
}

export function exportFilenameStem(analysisId: string, createdAt: string): string {
  const date = new Date(createdAt).toISOString().slice(0, 10);
  return `analysis-${analysisId}-${date}`;
}

export function formatCreatedDate(createdAt: string): string {
  return new Date(createdAt).toISOString().slice(0, 10);
}
