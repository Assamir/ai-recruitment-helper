import { useState } from "react";
import { User } from "lucide-react";
import { FileUpload } from "./FileUpload";
import { ProfileSelector } from "./ProfileSelector";
import { FormField } from "@/components/auth/FormField";
import { MAX_CUSTOM_REQUIREMENTS_CHARS, MAX_PROJECT_CONTEXT_CHARS } from "@/lib/analysis/limits";

const TEXTAREA_CLASS =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 backdrop-blur-md focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30 focus:outline-none";

interface Profile {
  id: string;
  name: string;
  seniority_level: string | null;
  description: string;
}

interface AnalysisFormProps {
  profiles: Profile[];
}

export default function AnalysisForm({ profiles }: AnalysisFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [cvText, setCvText] = useState("");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [customRequirements, setCustomRequirements] = useState("");
  const [projectContext, setProjectContext] = useState("");
  const [customRequirementsOpen, setCustomRequirementsOpen] = useState(false);
  const [projectContextOpen, setProjectContextOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setError(null);

    const trimmedCustom = customRequirements.trim();

    if (!profileId && !trimmedCustom) {
      setError("Please select a job profile or enter custom job requirements.");
      return;
    }
    if (!file && !cvText.trim()) {
      setError("Please upload a CV file or paste CV text.");
      return;
    }
    if (trimmedCustom.length > MAX_CUSTOM_REQUIREMENTS_CHARS) {
      setError(`Custom job requirements exceed the ${MAX_CUSTOM_REQUIREMENTS_CHARS.toLocaleString()} character limit.`);
      return;
    }
    const trimmedContext = projectContext.trim();
    if (trimmedContext.length > MAX_PROJECT_CONTEXT_CHARS) {
      setError(`Project context exceeds the ${MAX_PROJECT_CONTEXT_CHARS.toLocaleString()} character limit.`);
      return;
    }

    setLoading(true);

    try {
      const body = new FormData();
      if (profileId) body.append("job_profile_id", profileId);
      if (trimmedCustom) body.append("custom_requirements", trimmedCustom);
      if (trimmedContext) body.append("project_context", trimmedContext);
      if (firstName.trim()) body.append("first_name", firstName.trim());
      if (lastName.trim()) body.append("last_name", lastName.trim());
      if (file) {
        body.append("file", file);
      } else {
        body.append("cv_text", cvText.trim());
      }

      const res = await fetch("/api/analysis", { method: "POST", body });
      const json = (await res.json()) as { analysis_id?: string; error?: string };

      if (!res.ok) {
        setError(json.error ?? "Something went wrong. Please try again.");
        return;
      }

      if (json.analysis_id) {
        window.location.href = `/dashboard/${json.analysis_id}`;
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      className="space-y-6 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl"
    >
      <FileUpload file={file} onFileChange={setFile} cvText={cvText} onCvTextChange={setCvText} />

      <div className="grid grid-cols-2 gap-3">
        <FormField
          id="first_name"
          label="First name (optional)"
          value={firstName}
          onChange={setFirstName}
          placeholder="Jane"
          icon={<User className="size-4" />}
        />
        <FormField
          id="last_name"
          label="Last name (optional)"
          value={lastName}
          onChange={setLastName}
          placeholder="Smith"
          icon={<User className="size-4" />}
        />
      </div>

      <ProfileSelector profiles={profiles} selectedId={profileId} onChange={setProfileId} />

      <div className="space-y-3">
        <label className="block text-sm font-medium text-blue-100/80">Custom Job Requirements</label>
        <button
          type="button"
          onClick={() => {
            setCustomRequirementsOpen((o) => !o);
          }}
          className="text-xs text-blue-100/50 transition-colors hover:text-blue-100/80"
        >
          {customRequirementsOpen ? "▲ Hide" : "▼ Add custom job requirements"}
        </button>
        {customRequirementsOpen && (
          <textarea
            rows={6}
            placeholder="Describe the role requirements, must-have skills, seniority, certifications…"
            value={customRequirements}
            onChange={(e) => {
              setCustomRequirements(e.target.value);
            }}
            className={TEXTAREA_CLASS}
          />
        )}
        <p className="text-xs text-blue-100/40">
          Use instead of or alongside a profile. At least one of profile or custom requirements is required. Describe
          the role only — do not paste candidate personal data here (it is sent to the AI without anonymization).
        </p>
      </div>

      <div className="space-y-3">
        <label className="block text-sm font-medium text-blue-100/80">Project Context (optional)</label>
        <button
          type="button"
          onClick={() => {
            setProjectContextOpen((o) => !o);
          }}
          className="text-xs text-blue-100/50 transition-colors hover:text-blue-100/80"
        >
          {projectContextOpen ? "▲ Hide" : "▼ Add project context"}
        </button>
        {projectContextOpen && (
          <textarea
            rows={4}
            placeholder="Domain, methodology, tech stack, team structure…"
            value={projectContext}
            onChange={(e) => {
              setProjectContext(e.target.value);
            }}
            className={TEXTAREA_CLASS}
          />
        )}
        <p className="text-xs text-blue-100/40">
          Describe the project only — do not paste candidate personal data here (it is sent to the AI without
          anonymization).
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg border border-blue-400/40 bg-blue-500/30 px-4 py-3 text-sm font-semibold text-blue-100 transition-all hover:bg-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Submitting…" : "Analyze CV"}
      </button>
    </form>
  );
}
