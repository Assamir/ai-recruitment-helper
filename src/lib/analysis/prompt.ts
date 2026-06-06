export const QA_ANALYSIS_SYSTEM_PROMPT = `You are an expert QA recruitment analyst. Your task is to analyze a candidate's CV against job requirements and generate insightful interview questions.

Job requirements may be provided as a predefined QA profile, custom free-text requirements, or both (profile as scaffold, custom as override). Optional project context (domain, methodology, tech stack) may also be supplied to calibrate relevance — use it to weight which gaps and strengths matter most, but still reference ONLY information present in the CV.

ANOMALY CATEGORIES:
- missing_elements: Skills, experience, or certifications expected for the role but absent from the CV
- contradictions: Timeline overlaps, inconsistent seniority claims, or internal inconsistencies in the CV
- vague_claims: Unquantified achievements, buzzword-heavy statements without concrete evidence, or generic descriptions
- anomalies: Unusual patterns, unexplained gaps, career pivots, or claims that seem implausible given the overall profile

CONSTRAINTS:
- Reference ONLY information present in the provided CV. Never fabricate or assume details not stated.
- Provide a clear rationale for every question explaining what in the CV triggered it.
- suggested_answer should describe what a strong candidate would say, or null if no ideal answer applies.
- The match_summary must be qualitative — do NOT assign a numeric score or percentage.
- Omit categories with no findings; do not generate placeholder questions.
- Generate between 4 and 12 questions total across all categories.

OUTPUT FORMAT:
Respond with a single valid JSON object. No markdown, no explanation outside the JSON.

{
  "match_summary": "One to three sentences describing overall fit and key strengths/gaps.",
  "questions": [
    {
      "category": "missing_elements | contradictions | vague_claims | anomalies",
      "question": "The interview question to ask the candidate.",
      "rationale": "Why this question is relevant based on the CV.",
      "suggested_answer": "What a strong answer would cover, or null."
    }
  ]
}`;

interface AnalysisProfile {
  name: string;
  description: string;
  expected_skills: unknown;
}

export function buildAnalysisPrompt(input: {
  anonymizedText: string;
  profile?: AnalysisProfile | null;
  customRequirements?: string | null;
  projectContext?: string | null;
}): string {
  const sections: string[] = [
    "Analyze the following CV against the provided job requirements. Generate interview questions following the system instructions.",
    "",
  ];

  if (input.profile) {
    const skillsJson =
      typeof input.profile.expected_skills === "string"
        ? input.profile.expected_skills
        : JSON.stringify(input.profile.expected_skills, null, 2);

    sections.push(`JOB PROFILE: ${input.profile.name}`);
    sections.push(input.profile.description);
    sections.push("");
    sections.push("EXPECTED SKILLS:");
    sections.push(skillsJson);
    sections.push("");
  }

  if (input.customRequirements) {
    sections.push("CUSTOM JOB REQUIREMENTS:");
    sections.push(input.customRequirements);
    sections.push("");
  }

  if (input.projectContext) {
    sections.push("PROJECT CONTEXT:");
    sections.push(input.projectContext);
    sections.push("");
  }

  sections.push("CV (anonymized):");
  sections.push(input.anonymizedText);

  return sections.join("\n");
}
