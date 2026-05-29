import { useState, useCallback } from "react";
import { AnalysisProgress } from "./AnalysisProgress";
import { AnalysisResults } from "./AnalysisResults";

interface Question {
  id: string;
  category: string;
  question: string;
  rationale: string;
  suggested_answer: string;
  sort_order: number;
}

interface ResultData {
  analysis: {
    id: string;
    status: string;
    match_summary: string | null;
    error_message: string | null;
    created_at: string;
    completed_at: string | null;
  };
  questions: Question[];
  candidate: { id: string; file_name: string | null };
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

  const handleFailed = useCallback((errorMessage: string | null) => {
    setFailed(errorMessage ?? "Analysis failed.");
    setLoading(false);
  }, []);

  // Immediately fetch results if already completed on server-side render
  useState(() => {
    if (initialStatus === "completed") {
      void fetchResults();
    }
  });

  if (loading && !results) {
    return <AnalysisProgress analysisId={analysisId} onCompleted={handleCompleted} onFailed={handleFailed} />;
  }

  if (failed && !results) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Analysis Failed</h2>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{failed}</div>
        <a
          href="/dashboard/new"
          className="inline-block rounded-lg border border-blue-400/30 bg-blue-500/20 px-4 py-2 text-sm text-blue-200 hover:bg-blue-500/30"
        >
          Try again
        </a>
      </div>
    );
  }

  if (!results) {
    return <div className="text-sm text-blue-100/50">Loading results…</div>;
  }

  return (
    <AnalysisResults
      questions={results.questions}
      matchSummary={results.analysis.match_summary}
      profile={results.profile}
      fileName={results.candidate.file_name}
      createdAt={results.analysis.created_at}
    />
  );
}
