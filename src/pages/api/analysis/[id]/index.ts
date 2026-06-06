import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { jsonResponse } from "@/lib/api/response";
import { isUuid } from "@/lib/api/uuid";
import { shouldDeleteCandidate } from "@/lib/analysis/candidate-cleanup";

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

  const { data: analysis, error: analysisError } = await supabase
    .from("analyses")
    .select("id, status, match_summary, error_message, created_at, completed_at, job_profile_id, candidate_id")
    .eq("id", id)
    .eq("user_id", context.locals.user.id)
    .single();

  if (analysisError) {
    return jsonResponse({ error: "Analysis not found", code: "NOT_FOUND" }, 404);
  }

  const [questionsResult, candidateResult, profileResult] = await Promise.all([
    supabase
      .from("analysis_questions")
      .select("id, category, question, rationale, suggested_answer, sort_order")
      .eq("analysis_id", id)
      .order("sort_order"),
    supabase.from("candidates").select("id, file_name").eq("id", analysis.candidate_id).single(),
    analysis.job_profile_id
      ? supabase
          .from("job_profiles")
          .select("id, name, description, expected_skills")
          .eq("id", analysis.job_profile_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
  ]);

  return jsonResponse(
    {
      analysis: {
        id: analysis.id,
        status: analysis.status,
        match_summary: analysis.match_summary,
        error_message: analysis.error_message,
        created_at: analysis.created_at,
        completed_at: analysis.completed_at,
      },
      questions: questionsResult.data ?? [],
      candidate: candidateResult.data ?? { id: analysis.candidate_id, file_name: null },
      profile: profileResult.data ?? null,
    },
    200,
  );
};

export const DELETE: APIRoute = async (context) => {
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

  const userId = context.locals.user.id;

  // 1. Read the analysis scoped to the user (RLS + explicit eq enforce ownership).
  //    Not-owned and not-found are intentionally indistinguishable → 404.
  const { data: analysis, error: readError } = await supabase
    .from("analyses")
    .select("id, candidate_id")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (readError ?? !analysis) {
    return jsonResponse({ error: "Analysis not found", code: "NOT_FOUND" }, 404);
  }

  const { candidate_id: candidateId } = analysis;

  // 2. Delete the analysis. analysis_questions cascade automatically.
  const { error: deleteError } = await supabase.from("analyses").delete().eq("id", id).eq("user_id", userId);

  if (deleteError) {
    return jsonResponse({ error: "Failed to delete analysis", code: "DB_ERROR" }, 500);
  }

  // 3. Conditionally delete the candidate when no other analyses reference it.
  //    Count is taken after deletion so the just-removed row is excluded.
  const { count } = await supabase
    .from("analyses")
    .select("id", { count: "exact", head: true })
    .eq("candidate_id", candidateId)
    .eq("user_id", userId);

  if (shouldDeleteCandidate(count ?? 0)) {
    // Non-fatal: the analysis is already gone; a stale candidate row is acceptable.
    await supabase.from("candidates").delete().eq("id", candidateId).eq("user_id", userId);
  }

  return jsonResponse({ success: true }, 200);
};
