import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { jsonResponse } from "@/lib/api/response";

export const GET: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse({ error: "Authentication required", code: "UNAUTHORIZED" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Database not configured", code: "SERVICE_UNAVAILABLE" }, 503);
  }

  const { data, error } = await supabase
    .from("job_profiles")
    .select("id, name, seniority_level, description")
    .order("name")
    .order("seniority_level");

  if (error) {
    return jsonResponse({ error: "Failed to fetch profiles", code: "DB_ERROR" }, 500);
  }

  return jsonResponse({ profiles: data }, 200);
};
