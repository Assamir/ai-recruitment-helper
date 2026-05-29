import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { jsonResponse } from "@/lib/api/response";

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse({ error: "Authentication required", code: "UNAUTHORIZED" }, 401);
  }

  const { id } = context.params;
  if (!id) {
    return jsonResponse({ error: "Analysis ID required", code: "BAD_REQUEST" }, 400);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Database not configured", code: "SERVICE_UNAVAILABLE" }, 503);
  }

  const { data: analysis, error: analysisError } = await supabase
    .from("analyses")
    .select("id, status, match_summary, error_message, created_at, completed_at, job_profile_id, candidate_id")
    .eq("id", id)
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
