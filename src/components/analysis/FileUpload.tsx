import { useState, useRef } from "react";

interface FileUploadProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  cvText: string;
  onCvTextChange: (text: string) => void;
}

const ACCEPTED_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const MAX_SIZE_MB = 5;

export function FileUpload({ file, onFileChange, cvText, onCvTextChange }: FileUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function validateAndSet(f: File) {
    setFileError(null);
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setFileError("Only PDF and DOCX files are accepted.");
      return;
    }
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setFileError(`File must be smaller than ${MAX_SIZE_MB}MB.`);
      return;
    }
    onFileChange(f);
    if (pasteOpen) setPasteOpen(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files.item(0);
    if (f) validateAndSet(f);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) validateAndSet(f);
  }

  function handlePasteChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onCvTextChange(e.target.value);
    if (e.target.value && file) onFileChange(null);
  }

  const formatBytes = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-blue-100/80">
        CV File <span className="text-red-400">*</span>
      </label>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 text-center transition-all ${
          dragging
            ? "border-blue-400/60 bg-blue-500/10"
            : "border-white/15 bg-white/5 hover:border-white/25 hover:bg-white/8"
        }`}
      >
        <input ref={inputRef} type="file" accept=".pdf,.docx" className="hidden" onChange={handleInputChange} />
        {file ? (
          <div className="space-y-1">
            <p className="font-medium text-white">{file.name}</p>
            <p className="text-xs text-blue-100/50">{formatBytes(file.size)}</p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFileChange(null);
                setFileError(null);
              }}
              className="mt-2 text-xs text-red-400/80 hover:text-red-400"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-sm text-blue-100/60">
              <span className="font-medium text-blue-300">Click to browse</span> or drag & drop
            </p>
            <p className="text-xs text-blue-100/40">PDF or DOCX, max 5 MB</p>
          </div>
        )}
      </div>

      {fileError && <p className="text-xs text-red-400">{fileError}</p>}

      {/* Paste fallback toggle */}
      <button
        type="button"
        onClick={() => {
          setPasteOpen((o) => !o);
        }}
        className="text-xs text-blue-100/50 transition-colors hover:text-blue-100/80"
      >
        {pasteOpen ? "▲ Hide" : "▼ Paste CV text instead"}
      </button>

      {pasteOpen && (
        <textarea
          rows={8}
          placeholder="Paste the full CV text here..."
          value={cvText}
          onChange={handlePasteChange}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 backdrop-blur-md focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30 focus:outline-none"
        />
      )}
    </div>
  );
}
