import type { APIRoute } from "astro";
import { LINKEDIN_SESSION_COOKIE } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { jsonResponse } from "@/lib/api/response";
import { isUuid } from "@/lib/api/uuid";
import { extractText, CVParseError, MAX_CV_TEXT_CHARS } from "@/lib/cv-parser/index";
import { assertUsableCvText } from "@/lib/cv-parser/quality";
import { anonymizeCV } from "@/lib/anonymizer/index";
import { getLLMConfig, createLLMModel, completeLLM } from "@/lib/llm";
import { AnalysisResponseSchema } from "@/lib/analysis/schema";
import { getAnalysisSystemPrompt, buildAnalysisPrompt } from "@/lib/analysis/prompt";
import {
  MAX_CUSTOM_REQUIREMENTS_CHARS,
  MAX_PROJECT_CONTEXT_CHARS,
  MAX_LINKEDIN_TEXT_CHARS,
} from "@/lib/analysis/limits";
import { splitFullName, extractCandidateName } from "@/lib/candidate/name";
import { getWorkerBindings } from "@/lib/cloudflare/env";
import { isLinkedinProfileUrl } from "@/lib/linkedin/url";
import { LinkedInAuthError, LinkedInNotFoundError } from "@/lib/linkedin/errors";
import type { TablesUpdate } from "@/db/database.types";

const LINKEDIN_UNAVAILABLE_NOTE = "LinkedIn could not be fetched — paste profile text to include it in the analysis.";
const LINKEDIN_SESSION_EXPIRED_NOTE =
  "LinkedIn session expired — re-authenticate and refresh the LINKEDIN_SESSION_COOKIE secret, then retry. Profile text was not cross-referenced.";
const LINKEDIN_NOT_FOUND_NOTE = "LinkedIn profile not found — check the URL. Analysis used the CV only.";

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

  const jobProfileIdField = formData.get("job_profile_id");
  const customRequirementsField = formData.get("custom_requirements");
  const projectContextField = formData.get("project_context");
  const linkedinTextField = formData.get("linkedin_text");
  const linkedinUrlField = formData.get("linkedin_url");
  const candidateIdField = formData.get("candidate_id");
  const firstNameField = formData.get("first_name");
  const lastNameField = formData.get("last_name");
  const file = formData.get("file");
  const cvTextField = formData.get("cv_text");

  const jobProfileId =
    typeof jobProfileIdField === "string" && jobProfileIdField.trim().length > 0 ? jobProfileIdField.trim() : null;

  if (jobProfileId && !isUuid(jobProfileId)) {
    return jsonResponse({ error: "Invalid job_profile_id format", code: "BAD_REQUEST" }, 400);
  }

  const customRequirements =
    typeof customRequirementsField === "string" && customRequirementsField.trim().length > 0
      ? customRequirementsField.trim()
      : null;

  const projectContext =
    typeof projectContextField === "string" && projectContextField.trim().length > 0
      ? projectContextField.trim()
      : null;

  const linkedinText =
    typeof linkedinTextField === "string" && linkedinTextField.trim().length > 0 ? linkedinTextField.trim() : null;

  const linkedinUrl =
    typeof linkedinUrlField === "string" && linkedinUrlField.trim().length > 0 ? linkedinUrlField.trim() : null;

  if (!jobProfileId && !customRequirements) {
    return jsonResponse({ error: "Provide a job profile or custom job requirements", code: "BAD_REQUEST" }, 400);
  }

  if (customRequirements && customRequirements.length > MAX_CUSTOM_REQUIREMENTS_CHARS) {
    return jsonResponse(
      {
        error: `Custom job requirements exceed the ${MAX_CUSTOM_REQUIREMENTS_CHARS.toLocaleString()} character limit`,
        code: "BAD_REQUEST",
      },
      400,
    );
  }

  if (projectContext && projectContext.length > MAX_PROJECT_CONTEXT_CHARS) {
    return jsonResponse(
      {
        error: `Project context exceeds the ${MAX_PROJECT_CONTEXT_CHARS.toLocaleString()} character limit`,
        code: "BAD_REQUEST",
      },
      400,
    );
  }

  if (linkedinText && linkedinText.length > MAX_LINKEDIN_TEXT_CHARS) {
    return jsonResponse(
      {
        error: `LinkedIn text exceeds the ${MAX_LINKEDIN_TEXT_CHARS.toLocaleString()} character limit`,
        code: "BAD_REQUEST",
      },
      400,
    );
  }

  if (linkedinUrl && !isLinkedinProfileUrl(linkedinUrl)) {
    return jsonResponse({ error: "Invalid LinkedIn profile URL", code: "BAD_REQUEST" }, 400);
  }

  // ── CV text extraction (synchronous front-half) ──────────────────────────
  let cvText: string;
  let fileName: string | null = null;
  let storedLinkedinText: string | null = linkedinText;
  let candidateId: string | null = typeof candidateIdField === "string" ? candidateIdField : null;

  if (candidateId && !isUuid(candidateId)) {
    return jsonResponse({ error: "Invalid candidate_id format", code: "BAD_REQUEST" }, 400);
  }

  if (candidateId) {
    // Retry path: read stored CV text from existing candidate record
    const { data: candidate, error } = await supabase
      .from("candidates")
      .select("cv_text, file_name, linkedin_text")
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
    storedLinkedinText = candidate.linkedin_text;
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
        linkedin_text: storedLinkedinText,
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
      custom_requirements: customRequirements,
      project_context: projectContext,
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
  const capturedLinkedinText = storedLinkedinText;
  const capturedLinkedinUrl = candidateIdField ? null : linkedinUrl;
  const capturedJobProfileId = jobProfileId;
  const capturedCustomRequirements = customRequirements;
  const capturedProjectContext = projectContext;
  const cfCtx = context.locals.cfContext;
  const workerBindings = await getWorkerBindings();
  const linkedinSessionCookie = workerBindings?.LINKEDIN_SESSION_COOKIE ?? LINKEDIN_SESSION_COOKIE ?? undefined;

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
        let resolvedLinkedinText = capturedLinkedinText;
        let linkedinScrapeNote: string | null = null;

        await setStatus({ status: "anonymizing" });

        if (!resolvedLinkedinText && capturedLinkedinUrl) {
          const browser = workerBindings?.BROWSER;

          if (browser && linkedinSessionCookie) {
            try {
              const { scrapeLinkedinProfile } = await import("@/lib/linkedin/scrape");
              const scraped = await scrapeLinkedinProfile({
                browser,
                url: capturedLinkedinUrl,
                sessionCookie: linkedinSessionCookie,
              });
              resolvedLinkedinText = scraped.text;

              const { error: linkedinPersistError } = await supabase
                .from("candidates")
                .update({ linkedin_text: resolvedLinkedinText })
                .eq("id", candidateId);
              if (linkedinPersistError) {
                // eslint-disable-next-line no-console -- best-effort LinkedIn persistence failure signal
                console.error(`linkedin_text write failed for analysis ${analysisId}: ${linkedinPersistError.message}`);
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : "LinkedIn scrape failed";
              // eslint-disable-next-line no-console -- non-fatal scrape failure signal
              console.error(`LinkedIn scrape failed for analysis ${analysisId}: ${message}`);
              // Tailor the note: a dead session needs a human to refresh li_at,
              // a bad URL is the user's to fix; otherwise stay generic.
              if (err instanceof LinkedInNotFoundError) {
                linkedinScrapeNote = LINKEDIN_NOT_FOUND_NOTE;
              } else if (err instanceof LinkedInAuthError) {
                linkedinScrapeNote = LINKEDIN_SESSION_EXPIRED_NOTE;
              } else {
                linkedinScrapeNote = LINKEDIN_UNAVAILABLE_NOTE;
              }
            }
          } else {
            linkedinScrapeNote = LINKEDIN_UNAVAILABLE_NOTE;
          }
        }

        const hasLinkedin = Boolean(resolvedLinkedinText?.trim());
        let cvForPrompt: string;

        if (hasLinkedin) {
          cvForPrompt = capturedCvText;
        } else {
          const { anonymizedText, piiMap } = anonymizeCV(capturedCvText);
          cvForPrompt = anonymizedText;

          const { error: piiError } = await supabase
            .from("candidates")
            .update({ pii_map: piiMap })
            .eq("id", candidateId);
          if (piiError) {
            // eslint-disable-next-line no-console -- best-effort PII persistence failure signal
            console.error(`pii_map write failed for analysis ${analysisId}: ${piiError.message}`);
          }
        }

        // Stage: analyzing
        await setStatus({ status: "analyzing", linkedin_scrape_note: linkedinScrapeNote });

        let profile: { name: string; description: string; expected_skills: unknown } | null = null;

        if (capturedJobProfileId) {
          const { data: profileRow } = await supabase
            .from("job_profiles")
            .select("name, description, expected_skills")
            .eq("id", capturedJobProfileId)
            .single();

          if (!profileRow) throw new Error("Job profile not found");
          profile = profileRow;
        }

        const userPrompt = buildAnalysisPrompt({
          anonymizedText: cvForPrompt,
          profile,
          customRequirements: capturedCustomRequirements,
          projectContext: capturedProjectContext,
          linkedinText: resolvedLinkedinText,
        });

        const { data: llmResult } = await completeLLM({
          model: llmModel,
          schema: AnalysisResponseSchema,
          prompt: userPrompt,
          systemPrompt: getAnalysisSystemPrompt({ hasLinkedin }),
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
          linkedin_scrape_note: linkedinScrapeNote,
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
