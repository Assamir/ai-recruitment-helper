import { z } from "zod/v4";

export const AnalysisCategory = z.enum(["missing_elements", "contradictions", "vague_claims", "anomalies"]);

export type AnalysisCategory = z.infer<typeof AnalysisCategory>;

export const AnalysisQuestionSchema = z.object({
  category: AnalysisCategory,
  question: z.string(),
  rationale: z.string(),
  suggested_answer: z.string().nullable(),
});

export type AnalysisQuestion = z.infer<typeof AnalysisQuestionSchema>;

export const AnalysisResponseSchema = z.object({
  match_summary: z.string(),
  questions: z.array(AnalysisQuestionSchema),
});

export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;
