import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { jsonResponse } from "@/lib/api/response";
import { isUuid } from "@/lib/api/uuid";
import { extractText, CVParseError, MAX_CV_TEXT_CHARS } from "@/lib/cv-parser/index";
import { assertUsableCvText } from "@/lib/cv-parser/quality";
import { anonymizeCV } from "@/lib/anonymizer/index";
import { getLLMConfig, createLLMModel, completeLLM } from "@/lib/llm";
import { AnalysisResponseSchema } from "@/lib/analysis/schema";
import { QA_ANALYSIS_SYSTEM_PROMPT, buildAnalysisPrompt } from "@/lib/analysis/prompt";
import { splitFullName, extractCandidateName } from "@/lib/candidate/name";
import type { TablesUpdate } from "@/db/database.types";

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse({ error: "Authentication required", code: "UNAUTHORIZED" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse({ error: "Database not configured", code: "SERVICE_UNAVAILABLE" }, 503);
  }

  const userId = context.locals.user.id;

  // ── Parse form data ──────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await context.request.formData();
  } catch {
    return jsonResponse({ error: "Invalid form data", code: "BAD_REQUEST" }, 400);
  }

  const jobProfileId = formData.get("job_profile_id");
  const candidateIdField = formData.get("candidate_id");
  const firstNameField = formData.get("first_name");
  const lastNameField = formData.get("last_name");
  const file = formData.get("file");
  const cvTextField = formData.get("cv_text");

  if (!jobProfileId || typeof jobProfileId !== "string") {
    return jsonResponse({ error: "job_profile_id is required", code: "BAD_REQUEST" }, 400);
  }
  if (!isUuid(jobProfileId)) {
    return jsonResponse({ error: "Invalid job_profile_id format", code: "BAD_REQUEST" }, 400);
  }

  // ── CV text extraction (synchronous front-half) ──────────────────────────
  let cvText: string;
  let fileName: string | null = null;
  let candidateId: string | null = typeof candidateIdField === "string" ? candidateIdField : null;

  if (candidateId && !isUuid(candidateId)) {
    return jsonResponse({ error: "Invalid candidate_id format", code: "BAD_REQUEST" }, 400);
  }

  if (candidateId) {
    // Retry path: read stored CV text from existing candidate record
    const { data: candidate, error } = await supabase
      .from("candidates")
      .select("cv_text, file_name")
      .eq("id", candidateId)
      .eq("user_id", userId)
      .single();

    if (error) {
      return jsonResponse({ error: "Candidate not found or has no CV text", code: "NOT_FOUND" }, 404);
    }
    const storedText = candidate.cv_text;
    if (!storedText) {
      return jsonResponse({ error: "Candidate has no stored CV text", code: "NOT_FOUND" }, 404);
    }
    cvText = storedText;
    fileName = candidate.file_name;
  } else if (file instanceof File) {
    try {
      cvText = await extractText(file);
      fileName = file.name;
    } catch (err) {
      if (err instanceof CVParseError) {
        return jsonResponse({ error: err.message, code: err.code }, 400);
      }
      return jsonResponse({ error: "Failed to read uploaded file", code: "PARSE_FAILED" }, 400);
    }
  } else if (typeof cvTextField === "string" && cvTextField.trim().length > 0) {
    cvText = cvTextField.trim();
    if (cvText.length > MAX_CV_TEXT_CHARS) {
      return jsonResponse(
        {
          error: `Pasted CV text exceeds the ${MAX_CV_TEXT_CHARS.toLocaleString()} character limit`,
          code: "BAD_REQUEST",
        },
        400,
      );
    }
    fileName = "pasted-cv.txt";
  } else {
    return jsonResponse({ error: "Provide a file, cv_text, or candidate_id", code: "BAD_REQUEST" }, 400);
  }

  try {
    assertUsableCvText(cvText);
  } catch (err) {
    if (err instanceof CVParseError) {
      return jsonResponse({ error: err.message, code: err.code }, 400);
    }
    throw err;
  }

  // ── Resolve candidate name (recruiter input wins, else CV header heuristic) ──
  const recruiterFirst = typeof firstNameField === "string" ? firstNameField.trim() : "";
  const recruiterLast = typeof lastNameField === "string" ? lastNameField.trim() : "";
  const { firstName: resolvedFirst, lastName: resolvedLast } =
    recruiterFirst || recruiterLast
      ? splitFullName(`${recruiterFirst} ${recruiterLast}`.trim())
      : extractCandidateName(cvText);

  // ── Create DB records ────────────────────────────────────────────────────
  if (!candidateId) {
    const { data: candidate, error: candidateError } = await supabase
      .from("candidates")
      .insert({
        user_id: userId,
        cv_text: cvText,
        file_name: fileName,
        first_name: resolvedFirst,
        last_name: resolvedLast,
      })
      .select("id")
      .single();

    if (candidateError) {
      return jsonResponse({ error: "Failed to create candidate record", code: "DB_ERROR" }, 500);
    }
    candidateId = candidate.id;
  }

  const { data: analysis, error: analysisError } = await supabase
    .from("analyses")
    .insert({
      user_id: userId,
      candidate_id: candidateId,
      job_profile_id: jobProfileId,
      status: "parsing",
    })
    .select("id")
    .single();

  if (analysisError) {
    return jsonResponse({ error: "Failed to create analysis record", code: "DB_ERROR" }, 500);
  }

  const analysisId = analysis.id;

  // ── Validate LLM config before handing off to background ─────────────────
  const llmConfig = getLLMConfig();
  const llmModel = llmConfig ? createLLMModel(llmConfig) : null;
  if (!llmModel) {
    await supabase
      .from("analyses")
      .update({ status: "failed", error_message: "LLM provider is not configured" })
      .eq("id", analysisId);
    return jsonResponse({ error: "LLM provider is not configured", code: "LLM_CONFIG_ERROR" }, 503);
  }

  // ── Background pipeline via waitUntil ────────────────────────────────────
  const capturedCvText = cvText;
  const capturedJobProfileId = jobProfileId;
  const cfCtx = context.locals.cfContext;

  // Without waitUntil the background pipeline can't run; don't leave the row
  // stuck on "parsing" — mark it failed synchronously and report 503.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- types declare cfContext as always-present, but it can be absent on misconfigured/non-CF runtimes
  if (!cfCtx?.waitUntil) {
    await supabase
      .from("analyses")
      .update({ status: "failed", error_message: "Background processing is unavailable" })
      .eq("id", analysisId);
    return jsonResponse({ error: "Background processing is unavailable", code: "SERVICE_UNAVAILABLE" }, 503);
  }

  cfCtx.waitUntil(
    (async () => {
      // Throw on any failed status write so a stuck pipeline surfaces via the
      // catch path instead of leaving the client polling until timeout.
      const setStatus = async (fields: TablesUpdate<"analyses">) => {
        const { error } = await supabase.from("analyses").update(fields).eq("id", analysisId);
        if (error) throw new Error(`Failed to update analysis status: ${error.message}`);
      };

      try {
        // Stage: anonymizing
        await setStatus({ status: "anonymizing" });

        const { anonymizedText, piiMap } = anonymizeCV(capturedCvText);

        // Persist pii_map for the owning candidate (UPDATE authorized by the
        // "Users update own candidates" RLS policy).
        const { error: piiError } = await supabase.from("candidates").update({ pii_map: piiMap }).eq("id", candidateId);
        if (piiError) {
          // eslint-disable-next-line no-console -- best-effort PII persistence failure signal
          console.error(`pii_map write failed for analysis ${analysisId}: ${piiError.message}`);
        }

        // Stage: analyzing
        await setStatus({ status: "analyzing" });

        const { data: profile } = await supabase
          .from("job_profiles")
          .select("name, description, expected_skills")
          .eq("id", capturedJobProfileId)
          .single();

        if (!profile) throw new Error("Job profile not found");

        const userPrompt = buildAnalysisPrompt(anonymizedText, profile);

        const { data: llmResult } = await completeLLM({
          model: llmModel,
          schema: AnalysisResponseSchema,
          prompt: userPrompt,
          systemPrompt: QA_ANALYSIS_SYSTEM_PROMPT,
        });

        // Stage: completed — write questions then flip status
        const questions = llmResult.questions.map((q, i) => ({
          analysis_id: analysisId,
          category: q.category,
          question: q.question,
          rationale: q.rationale,
          suggested_answer: q.suggested_answer,
          sort_order: i,
        }));

        if (questions.length > 0) {
          const { error: questionsError } = await supabase.from("analysis_questions").insert(questions);
          if (questionsError) throw new Error(`Failed to write analysis questions: ${questionsError.message}`);
        }

        await setStatus({
          status: "completed",
          match_summary: llmResult.match_summary,
          raw_response: JSON.stringify(llmResult),
          completed_at: new Date().toISOString(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected pipeline error";
        const { error: failError } = await supabase
          .from("analyses")
          .update({ status: "failed", error_message: message })
          .eq("id", analysisId);
        if (failError) {
          // eslint-disable-next-line no-console -- last-resort signal when the failure write itself fails
          console.error(`Failed to mark analysis ${analysisId} as failed: ${failError.message} (original: ${message})`);
        }
      }
    })(),
  );

  return jsonResponse({ analysis_id: analysisId }, 201);
};
