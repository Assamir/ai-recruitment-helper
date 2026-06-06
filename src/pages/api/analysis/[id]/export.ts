import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { fileResponse, jsonResponse } from "@/lib/api/response";
import { isUuid } from "@/lib/api/uuid";
import { toMarkdown, markdownFilename } from "@/lib/export/markdown";
import { toPrintableHtml } from "@/lib/export/html";
import type { ExportReport, RedactionSeed } from "@/lib/export/types";

function buildRedactionSeed(candidate: {
  pii_map?: unknown;
  first_name?: string | null;
  last_name?: string | null;
}): RedactionSeed {
  const first = candidate.first_name?.trim() ?? "";
  const last = candidate.last_name?.trim() ?? "";
  const full = [first, last].filter(Boolean).join(" ");
  const candidateNames = [first, last, full].filter(Boolean);
  const rawMap = candidate.pii_map;
  const piiMapValues =
    rawMap && typeof rawMap === "object" && !Array.isArray(rawMap)
      ? Object.values(rawMap as Record<string, string>).filter(Boolean)
      : [];
  return { piiMapValues, candidateNames };
}

function buildExportReport(
  analysis: {
    id: string;
    match_summary: string | null;
    linkedin_scrape_note: string | null;
    created_at: string;
    custom_requirements: string | null;
    project_context: string | null;
  },
  questions: {
    category: string;
    question: string;
    rationale: string;
    suggested_answer: string | null;
  }[],
  profile: { name: string; seniority_level?: string | null; description?: string | null } | null,
  hasLinkedin: boolean,
): ExportReport {
  return {
    analysisId: analysis.id,
    matchSummary: analysis.match_summary,
    questions: questions.map((q) => ({
      category: q.category as ExportReport["questions"][number]["category"],
      question: q.question,
      rationale: q.rationale,
      suggested_answer: q.suggested_answer,
    })),
    profile: profile
      ? {
          name: profile.name,
          seniority_level: profile.seniority_level,
          description: profile.description,
        }
      : null,
    customRequirements: analysis.custom_requirements,
    projectContext: analysis.project_context,
    hasLinkedin,
    linkedinScrapeNote: analysis.linkedin_scrape_note,
    createdAt: analysis.created_at,
  };
}

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse({ error: "Authentication required", code: "UNAUTHORIZED" }, 401);
  }

  const { id } = context.params;
  if (!id) {
    return jsonResponse({ error: "Analysis ID required", code: "BAD_REQUEST" }, 400);
  }
  if (!isUuid(id)) {
    return jsonResponse({ error: "Invalid analysis ID format", code: "BAD_REQUEST" }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Database not configured", code: "SERVICE_UNAVAILABLE" }, 503);
  }

  const format = context.url.searchParams.get("format");
  if (format !== "md" && format !== "pdf") {
    return jsonResponse({ error: "Invalid or missing format parameter", code: "BAD_REQUEST" }, 400);
  }

  const { data: analysis, error: analysisError } = await supabase
    .from("analyses")
    .select(
      "id, status, match_summary, linkedin_scrape_note, created_at, job_profile_id, candidate_id, custom_requirements, project_context",
    )
    .eq("id", id)
    .eq("user_id", context.locals.user.id)
    .single();

  if (analysisError) {
    return jsonResponse({ error: "Analysis not found", code: "NOT_FOUND" }, 404);
  }

  if (analysis.status !== "completed") {
    return jsonResponse({ error: "Analysis is not completed", code: "ANALYSIS_NOT_COMPLETED" }, 409);
  }

  const [questionsResult, candidateResult, profileResult] = await Promise.all([
    supabase
      .from("analysis_questions")
      .select("category, question, rationale, suggested_answer, sort_order")
      .eq("analysis_id", id)
      .order("sort_order"),
    supabase
      .from("candidates")
      .select("pii_map, first_name, last_name, linkedin_text")
      .eq("id", analysis.candidate_id)
      .single(),
    analysis.job_profile_id
      ? supabase
          .from("job_profiles")
          .select("name, seniority_level, description")
          .eq("id", analysis.job_profile_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const candidate = candidateResult.data ?? {
    pii_map: null,
    first_name: null,
    last_name: null,
    linkedin_text: null,
  };
  const hasLinkedin = Boolean(candidate.linkedin_text?.trim());
  const report = buildExportReport(analysis, questionsResult.data ?? [], profileResult.data ?? null, hasLinkedin);
  const seed = buildRedactionSeed(candidate);

  if (format === "md") {
    const body = toMarkdown(report, seed);
    return fileResponse(body, {
      contentType: "text/markdown; charset=utf-8",
      filename: markdownFilename(report),
      disposition: "attachment",
    });
  }

  return fileResponse(toPrintableHtml(report, seed), {
    contentType: "text/html; charset=utf-8",
    disposition: "inline",
  });
};
