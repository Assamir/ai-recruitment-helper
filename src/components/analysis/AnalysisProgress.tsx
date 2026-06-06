import { useEffect, useState } from "react";

interface StatusResponse {
  status: string;
  match_summary?: string;
  error_message?: string;
}

interface AnalysisProgressProps {
  analysisId: string;
  onCompleted: (matchSummary: string | null) => void;
  onFailed: (errorMessage: string | null) => void;
}

const STAGES = ["parsing", "anonymizing", "analyzing"];

const STAGE_LABELS: Record<string, string> = {
  parsing: "Extracting CV text",
  anonymizing: "Anonymizing PII",
  analyzing: "Analyzing with LLM",
  completed: "Completed",
  failed: "Failed",
};

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 60;

export function AnalysisProgress({ analysisId, onCompleted, onFailed }: AnalysisProgressProps) {
  const [status, setStatus] = useState<string>("parsing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let polls = 0;
    let timerId: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/analysis/${analysisId}/status`);
        // 401/404 won't resolve by waiting — the analysis is gone or access
        // is denied. Fail fast instead of polling until the timeout.
        if (res.status === 401 || res.status === 404) {
          const msg = res.status === 401 ? "You are not authorized to view this analysis." : "Analysis not found.";
          setStatus("failed");
          setErrorMessage(msg);
          onFailed(msg);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as StatusResponse;
        setStatus(data.status);

        if (data.status === "completed") {
          onCompleted(data.match_summary ?? null);
          return;
        }
        if (data.status === "failed") {
          const msg = data.error_message ?? "Analysis failed. Please try again.";
          setErrorMessage(msg);
          onFailed(msg);
          return;
        }
      } catch {
        // network hiccup — keep polling
      }

      polls++;
      if (polls < MAX_POLLS) {
        timerId = setTimeout(() => {
          void poll();
        }, POLL_INTERVAL_MS);
      } else {
        setStatus("failed");
        const msg = "Analysis timed out. Please try again.";
        setErrorMessage(msg);
        onFailed(msg);
      }
    }

    void poll();
    return () => {
      clearTimeout(timerId);
    };
  }, [analysisId, onCompleted, onFailed]);

  const currentStageIndex = STAGES.indexOf(status);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-white">Analyzing CV…</h2>

      {/* Stage stepper */}
      <div className="space-y-3">
        {STAGES.map((stage, i) => {
          const done = currentStageIndex > i;
          const active = currentStageIndex === i;
          return (
            <div key={stage} className="flex items-center gap-3">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-all ${
                  done
                    ? "border-green-500/50 bg-green-500/20 text-green-300"
                    : active
                      ? "border-blue-400/60 bg-blue-500/20 text-blue-200"
                      : "border-white/15 bg-white/5 text-white/30"
                }`}
              >
                {done ? "✓" : i + 1}
              </div>
              <span
                className={`text-sm ${
                  done ? "text-green-300" : active ? "font-medium text-blue-200" : "text-white/40"
                }`}
              >
                {STAGE_LABELS[stage]}
              </span>
              {active && (
                <span className="ml-1 h-3 w-3 animate-spin rounded-full border border-blue-400 border-t-transparent" />
              )}
            </div>
          );
        })}
      </div>

      {status === "failed" && errorMessage && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
