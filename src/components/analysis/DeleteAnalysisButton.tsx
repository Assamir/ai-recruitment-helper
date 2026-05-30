import { useState } from "react";

interface DeleteAnalysisButtonProps {
  analysisId: string;
}

export default function DeleteAnalysisButton({ analysisId }: DeleteAnalysisButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!window.confirm("Delete this analysis? This cannot be undone.")) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/analysis/${analysisId}`, { method: "DELETE" });

      if (res.ok) {
        window.location.reload();
        return;
      }

      const json = (await res.json()) as { error?: string };
      setError(json.error ?? "Failed to delete. Please try again.");
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          void handleDelete();
        }}
        disabled={loading}
        aria-label="Delete analysis"
        className="flex h-7 w-7 items-center justify-center rounded-md border border-red-500/30 bg-red-500/10 text-red-400 transition-colors hover:border-red-500/50 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        )}
      </button>
      {error && (
        <p className="absolute top-9 right-0 z-10 w-48 rounded-md border border-red-500/30 bg-gray-900 px-2 py-1 text-xs text-red-400 shadow-lg">
          {error}
        </p>
      )}
    </div>
  );
}
