interface Profile {
  id: string;
  name: string;
  seniority_level: string | null;
  description: string;
}

interface ProfileSelectorProps {
  profiles: Profile[];
  selectedId: string | null;
  onChange: (id: string) => void;
}

export function ProfileSelector({ profiles, selectedId, onChange }: ProfileSelectorProps) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-blue-100/80">
        QA Job Profile <span className="text-red-400">*</span>
      </label>
      <select
        value={selectedId ?? ""}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white backdrop-blur-md transition-colors focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30 focus:outline-none"
      >
        <option value="" disabled className="bg-slate-900 text-white/60">
          — Select a profile —
        </option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id} className="bg-slate-900 text-white">
            {p.name}
            {p.seniority_level ? ` — ${p.seniority_level}` : ""}
          </option>
        ))}
      </select>
      {selectedId && (
        <p className="mt-1.5 text-xs text-blue-100/50">{profiles.find((p) => p.id === selectedId)?.description}</p>
      )}
    </div>
  );
}
