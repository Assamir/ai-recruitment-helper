import { useState } from "react";
import { User } from "lucide-react";
import { FileUpload } from "./FileUpload";
import { ProfileSelector } from "./ProfileSelector";
import { FormField } from "@/components/auth/FormField";

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
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setError(null);

    if (!profileId) {
      setError("Please select a job profile.");
      return;
    }
    if (!file && !cvText.trim()) {
      setError("Please upload a CV file or paste CV text.");
      return;
    }

    setLoading(true);

    try {
      const body = new FormData();
      body.append("job_profile_id", profileId);
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
