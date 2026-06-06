import { useState } from "react";

interface ExportReportButtonProps {
  analysisId: string;
}

export default function ExportReportButton({ analysisId }: ExportReportButtonProps) {
  const [loadingFormat, setLoadingFormat] = useState<"md" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(format: "md" | "pdf") {
    setLoadingFormat(format);
    setError(null);

    const url = `/api/analysis/${analysisId}/export?format=${format}`;

    try {
      const res = await fetch(url);

      if (format === "pdf") {
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(json?.error ?? "Export failed. Please try again.");
          return;
        }
        const html = await res.text();
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const objectUrl = URL.createObjectURL(blob);
        window.open(objectUrl, "_blank", "noopener,noreferrer");
        return;
      }

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? "Export failed. Please try again.");
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = /filename="([^"]+)"/.exec(disposition);
      const filename = filenameMatch?.[1] ?? `analysis-${analysisId}.md`;

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoadingFormat(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void handleExport("md")}
        disabled={loadingFormat !== null}
        className="rounded-lg border border-blue-400/30 bg-blue-500/20 px-3 py-1.5 text-sm text-blue-200 transition-colors hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loadingFormat === "md" ? "Exporting…" : "Export Markdown"}
      </button>
      <button
        type="button"
        onClick={() => void handleExport("pdf")}
        disabled={loadingFormat !== null}
        className="rounded-lg border border-blue-400/30 bg-blue-500/20 px-3 py-1.5 text-sm text-blue-200 transition-colors hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loadingFormat === "pdf" ? "Opening…" : "Export PDF"}
      </button>
      {error && <p className="w-full text-sm text-red-400">{error}</p>}
    </div>
  );
}
