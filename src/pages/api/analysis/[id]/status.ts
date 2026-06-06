import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { jsonResponse } from "@/lib/api/response";
import { isUuid } from "@/lib/api/uuid";

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

  const { data, error } = await supabase
    .from("analyses")
    .select("status, match_summary, error_message")
    .eq("id", id)
    .eq("user_id", context.locals.user.id)
    .single();

  if (error) {
    return jsonResponse({ error: "Analysis not found", code: "NOT_FOUND" }, 404);
  }

  return jsonResponse(
    {
      status: data.status,
      ...(data.match_summary ? { match_summary: data.match_summary } : {}),
      ...(data.error_message ? { error_message: data.error_message } : {}),
    },
    200,
  );
};
