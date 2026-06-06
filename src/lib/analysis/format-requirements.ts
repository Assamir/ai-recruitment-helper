export interface RequirementsProfile {
  name: string;
  seniority_level?: string | null;
}

export function formatRequirementsLabel(
  profile: RequirementsProfile | null,
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
