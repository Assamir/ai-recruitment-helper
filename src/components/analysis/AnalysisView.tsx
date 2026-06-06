import { useState, useEffect, useCallback } from "react";
import { AnalysisProgress } from "./AnalysisProgress";
import { AnalysisResults } from "./AnalysisResults";

interface Question {
  id: string;
  category: string;
  question: string;
  rationale: string;
  suggested_answer: string | null;
  sort_order: number;
}

interface ResultData {
  analysis: {
    id: string;
    status: string;
    match_summary: string | null;
    error_message: string | null;
    linkedin_scrape_note: string | null;
    created_at: string;
    completed_at: string | null;
    custom_requirements: string | null;
    project_context: string | null;
  };
  questions: Question[];
  candidate: { id: string; file_name: string | null; has_linkedin?: boolean };
  profile: { id: string; name: string; seniority_level?: string | null; description?: string | null } | null;
}

interface AnalysisViewProps {
  analysisId: string;
  initialStatus: string;
}

export default function AnalysisView({ analysisId, initialStatus }: AnalysisViewProps) {
  const isTerminal = initialStatus === "completed" || initialStatus === "failed";
  const [results, setResults] = useState<ResultData | null>(null);
  const [failed, setFailed] = useState<string | null>(initialStatus === "failed" ? "This analysis failed." : null);
  const [loading, setLoading] = useState(!isTerminal);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const fetchResults = useCallback(async () => {
    try {
      const res = await fetch(`/api/analysis/${analysisId}`);
      if (res.ok) {
        const data = (await res.json()) as ResultData;
        setResults(data);
      }
    } finally {
      setLoading(false);
    }
  }, [analysisId]);

  const handleCompleted = useCallback(
    (_matchSummary: string | null) => {
      void fetchResults();
    },
    [fetchResults],
  );

  const handleFailed = useCallback(
    (errorMessage: string | null) => {
      setFailed(errorMessage ?? "Analysis failed.");
      setLoading(false);
      // Load candidate/profile so the retry button can re-submit without a re-upload.
      void fetchResults();
    },
    [fetchResults],
  );

  // Re-run the analysis from the stored CV text — no re-upload needed.
  const handleRetry = useCallback(async () => {
    const candidateId = results?.candidate.id;
    const jobProfileId = results?.profile?.id;
    const customRequirements = results?.analysis.custom_requirements;
    if (!candidateId || (!jobProfileId && !customRequirements)) return;

    setRetrying(true);
    setRetryError(null);
    try {
      const form = new FormData();
      form.set("candidate_id", candidateId);
      if (jobProfileId) form.set("job_profile_id", jobProfileId);
      if (customRequirements) form.set("custom_requirements", customRequirements);
      const projectContext = results.analysis.project_context;
      if (projectContext) form.set("project_context", projectContext);
      const res = await fetch("/api/analysis", { method: "POST", body: form });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setRetryError(data?.error ?? "Retry failed. Please try again.");
        setRetrying(false);
        return;
      }
      const data = (await res.json()) as { analysis_id: string };
      window.location.href = `/dashboard/${data.analysis_id}`;
    } catch {
      setRetryError("Retry failed. Please try again.");
      setRetrying(false);
    }
  }, [results]);

  // Fetch results on mount when the server already rendered a terminal status.
  useEffect(() => {
    if (initialStatus === "completed" || initialStatus === "failed") {
      void fetchResults();
    }
  }, [initialStatus, fetchResults]);

  if (failed) {
    const canRetry = Boolean(results?.candidate.id && (results.profile?.id ?? results.analysis.custom_requirements));
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Analysis Failed</h2>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{failed}</div>
        {retryError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {retryError}
          </div>
        )}
        {canRetry ? (
          <button
            type="button"
            onClick={() => void handleRetry()}
            disabled={retrying}
            className="inline-block rounded-lg border border-blue-400/30 bg-blue-500/20 px-4 py-2 text-sm text-blue-200 hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {retrying ? "Retrying…" : "Retry analysis"}
          </button>
        ) : (
          <a
            href="/dashboard/new"
            className="inline-block rounded-lg border border-blue-400/30 bg-blue-500/20 px-4 py-2 text-sm text-blue-200 hover:bg-blue-500/30"
          >
            Try again
          </a>
        )}
      </div>
    );
  }

  if (loading && !results) {
    return <AnalysisProgress analysisId={analysisId} onCompleted={handleCompleted} onFailed={handleFailed} />;
  }

  if (!results) {
    return <div className="text-sm text-blue-100/50">Loading results…</div>;
  }

  return (
    <AnalysisResults
      questions={results.questions}
      matchSummary={results.analysis.match_summary}
      profile={results.profile}
      customRequirements={results.analysis.custom_requirements}
      projectContext={results.analysis.project_context}
      fileName={results.candidate.file_name}
      createdAt={results.analysis.created_at}
      hasLinkedin={results.candidate.has_linkedin ?? false}
      linkedinScrapeNote={results.analysis.linkedin_scrape_note}
    />
  );
}
