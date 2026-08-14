"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const MAX_BYTES = 10 * 1024 * 1024;

export function DocumentUploadForm({
  organizationSlug,
  replacement,
}: {
  organizationSlug: string;
  replacement?: { sourceId: string; expectedSourceVersion: number };
}) {
  const router = useRouter();
  const requestRef = useRef<XMLHttpRequest | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("file");
    if (!(file instanceof File) || file.size < 1) {
      setMessage("Choose a PDF, DOCX, or TXT document.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setMessage("Documents may not exceed 10 MiB.");
      return;
    }
    const payload = new FormData();
    payload.set("file", file);
    if (replacement) {
      payload.set("replacementSourceId", replacement.sourceId);
      payload.set(
        "expectedSourceVersion",
        String(replacement.expectedSourceVersion),
      );
    }
    const request = new XMLHttpRequest();
    requestRef.current = request;
    setBusy(true);
    setProgress(0);
    setMessage("Uploading private document…");
    request.open(
      "POST",
      `/api/orgs/${encodeURIComponent(organizationSlug)}/knowledge/documents/upload`,
    );
    request.responseType = "json";
    request.upload.onprogress = (upload) => {
      if (upload.lengthComputable) {
        setProgress(Math.round((upload.loaded / upload.total) * 100));
      }
    };
    request.onerror = () => finish("The upload failed before completion.");
    request.onabort = () => finish("The upload was cancelled.");
    request.onload = () => {
      const response = request.response as {
        ok?: boolean;
        message?: string;
        sourceId?: string;
        versionId?: string;
      } | null;
      if (
        request.status >= 200 &&
        request.status < 300 &&
        response?.ok &&
        response.sourceId &&
        response.versionId
      ) {
        setMessage("Upload complete. Scanning and extraction are queued.");
        setProgress(100);
        router.push(
          `/app/orgs/${organizationSlug}/knowledge/${response.sourceId}/versions/${response.versionId}`,
        );
        router.refresh();
        return;
      }
      finish(response?.message ?? "The document could not be uploaded.");
    };
    request.send(payload);
  }

  function finish(nextMessage: string) {
    setBusy(false);
    setProgress(null);
    setMessage(nextMessage);
    requestRef.current = null;
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <label
          htmlFor="knowledge-document"
          className="block text-sm font-medium"
        >
          Private document
        </label>
        <input
          id="knowledge-document"
          name="file"
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          required
          disabled={busy}
          className="block w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
        <p className="text-xs text-[var(--muted)]">
          PDF, DOCX, or UTF-8 TXT only. Maximum 10 MiB. Files remain private and
          are scanned before extraction.
        </p>
      </div>
      {progress !== null ? (
        <div className="space-y-1">
          <label htmlFor="document-upload-progress" className="text-sm">
            Upload progress: {progress}%
          </label>
          <progress
            id="document-upload-progress"
            value={progress}
            max={100}
            className="block w-full"
          />
        </div>
      ) : null}
      {message ? (
        <p className="text-sm" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
        >
          {busy ? "Uploading…" : replacement ? "Upload replacement" : "Upload"}
        </button>
        {busy ? (
          <button
            type="button"
            onClick={() => requestRef.current?.abort()}
            className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
