import type { AnalysisCategory } from "@/lib/analysis/schema";

export interface ExportQuestion {
  category: AnalysisCategory;
  question: string;
  rationale: string;
  suggested_answer: string | null;
}

export interface ExportProfile {
  name: string;
  seniority_level?: string | null;
  description?: string | null;
}

export interface ExportReport {
  analysisId: string;
  matchSummary: string | null;
  questions: ExportQuestion[];
  profile: ExportProfile | null;
  customRequirements?: string | null;
  projectContext?: string | null;
  hasLinkedin: boolean;
  linkedinScrapeNote?: string | null;
  createdAt: string;
}

export interface RedactionSeed {
  piiMapValues: string[];
  candidateNames: string[];
}
