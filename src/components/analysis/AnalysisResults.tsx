import type { AnalysisCategory } from "@/lib/analysis/schema";

interface Question {
  id: string;
  category: string;
  question: string;
  rationale: string;
  suggested_answer: string | null;
}

interface Profile {
  id: string;
  name: string;
  seniority_level?: string | null;
  description?: string | null;
}

interface AnalysisResultsProps {
  questions: Question[];
  matchSummary: string | null;
  profile: Profile | null;
  customRequirements?: string | null;
  projectContext?: string | null;
  fileName: string | null;
  createdAt: string;
  hasLinkedin?: boolean;
  linkedinScrapeNote?: string | null;
}

const CATEGORY_ORDER: AnalysisCategory[] = ["missing_elements", "contradictions", "vague_claims", "anomalies"];

const CATEGORY_LABELS: Record<AnalysisCategory, string> = {
  missing_elements: "Missing Elements",
  contradictions: "Contradictions",
  vague_claims: "Vague Claims",
  anomalies: "Anomalies",
};

const CATEGORY_ICONS: Record<AnalysisCategory, string> = {
  missing_elements: "📋",
  contradictions: "⚡",
  vague_claims: "🔍",
  anomalies: "⚠️",
};

function formatRequirementsLabel(
  profile: Profile | null,
  customRequirements?: string | null,
): { label: string; detail?: string } {
  const snippet = customRequirements
    ? customRequirements.length > 120
      ? `${customRequirements.slice(0, 120).trimEnd()}…`
      : customRequirements
    : undefined;

  if (profile) {
    const profileLabel = [profile.name, profile.seniority_level].filter(Boolean).join(" — ");
    return customRequirements
      ? { label: `${profileLabel} + custom requirements`, detail: snippet }
      : { label: profileLabel };
  }
  if (customRequirements) {
    return { label: "Custom requirements", detail: snippet };
  }
  return { label: "Unknown profile" };
}

export function AnalysisResults({
  questions,
  matchSummary,
  profile,
  customRequirements,
  projectContext,
  fileName,
  createdAt,
  hasLinkedin = false,
  linkedinScrapeNote,
}: AnalysisResultsProps) {
  const grouped = questions.reduce<Partial<Record<string, Question[]>>>((acc, q) => {
    (acc[q.category] ??= []).push(q);
    return acc;
  }, {});

  const requirements = formatRequirementsLabel(profile, customRequirements);

  const date = new Date(createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* Meta row */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-white">{fileName ?? "Pasted CV"}</h2>
          <p className="mt-0.5 text-sm text-blue-100/60">
            {requirements.label} · {date}
          </p>
          {requirements.detail && (
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-blue-100/50">{requirements.detail}</p>
          )}
          {projectContext && (
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-blue-100/40">
              <span className="font-medium text-blue-100/50">Project context:</span>{" "}
              {projectContext.length > 160 ? `${projectContext.slice(0, 160).trimEnd()}…` : projectContext}
            </p>
          )}
          {linkedinScrapeNote && (
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-amber-200/70">{linkedinScrapeNote}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasLinkedin && (
            <span className="rounded-full border border-sky-400/30 bg-sky-500/15 px-3 py-1 text-xs font-semibold text-sky-200">
              LinkedIn cross-referenced
            </span>
          )}
          <span className="rounded-full border border-green-500/30 bg-green-500/15 px-3 py-1 text-xs font-semibold text-green-300">
            Completed
          </span>
        </div>
      </div>

      {/* Summary */}
      {matchSummary && (
        <div className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-5 py-4">
          <p className="mb-1 text-xs font-semibold tracking-wider text-blue-300/70 uppercase">Match Summary</p>
          <p className="text-sm leading-relaxed text-blue-100/90">{matchSummary}</p>
        </div>
      )}

      {/* Questions grouped by category */}
      {CATEGORY_ORDER.map((key) => {
        const label = CATEGORY_LABELS[key];
        const qs = grouped[key];
        if (!qs?.length) return null;
        const icon = CATEGORY_ICONS[key];
        return (
          <section key={key}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-blue-100/70 uppercase">
              <span>{icon}</span> {label}
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-normal text-white/50">
                {qs.length}
              </span>
            </h3>
            <div className="space-y-3">
              {qs.map((q, idx) => (
                <QuestionCard key={q.id} question={q} index={idx + 1} />
              ))}
            </div>
          </section>
        );
      })}

      {questions.length === 0 && <p className="text-sm text-blue-100/50">No questions were generated.</p>}
    </div>
  );
}

function QuestionCard({ question, index }: { question: Question; index: number }) {
  return (
    <details className="group rounded-xl border border-white/10 bg-white/5 backdrop-blur-md open:border-white/20 open:bg-white/8">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-4">
        <span className="mt-0.5 shrink-0 text-xs font-bold text-blue-100/40">#{index}</span>
        <span className="flex-1 text-sm font-medium text-white">{question.question}</span>
        <span className="ml-2 shrink-0 text-blue-100/40 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="space-y-3 border-t border-white/10 px-5 py-4">
        {question.rationale && (
          <div>
            <p className="mb-1 text-xs font-semibold tracking-wider text-blue-300/60 uppercase">Why ask this</p>
            <p className="text-sm text-blue-100/80">{question.rationale}</p>
          </div>
        )}
        {question.suggested_answer && (
          <div>
            <p className="mb-1 text-xs font-semibold tracking-wider text-purple-300/60 uppercase">Suggested answer</p>
            <p className="text-sm text-blue-100/70">{question.suggested_answer}</p>
          </div>
        )}
      </div>
    </details>
  );
}
