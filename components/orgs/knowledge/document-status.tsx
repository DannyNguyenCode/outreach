"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import {
  acknowledgeDocumentDuplicateAction,
  retryKnowledgeDocumentAction,
} from "@/app/actions/knowledge";
import { initialActionState } from "@/app/actions/auth-state";
import { FormStatus } from "@/components/auth/form-status";
import { SubmitButton } from "@/components/auth/submit-button";

const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = 40;

export type DocumentStatusProps = {
  organizationSlug: string;
  sourceId: string;
  versionId: string;
  displayFilename: string;
  byteSize: string | null;
  scanState: string;
  processingState: string;
  attempts: number;
  safeErrorCode: string | null;
  exactDuplicateVersionId: string | null;
  nearDuplicateVersionId: string | null;
  duplicateAcknowledged: boolean;
  issues: Array<{
    id: string;
    severity: string;
    safeMessage: string;
    sectionLocator: string | null;
    resolved: boolean;
  }>;
};

export function DocumentStatus(props: DocumentStatusProps) {
  const router = useRouter();
  const [retryState, retryAction] = useActionState(
    retryKnowledgeDocumentAction,
    initialActionState,
  );
  const [ackState, acknowledgeAction] = useActionState(
    acknowledgeDocumentDuplicateAction,
    initialActionState,
  );
  const pending = ["UPLOADING", "QUEUED", "SCANNING", "EXTRACTING"].includes(
    props.processingState,
  );

  useEffect(() => {
    if (!pending) return;
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      router.refresh();
      if (polls >= MAX_POLLS) window.clearInterval(timer);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [pending, router]);

  const duplicate =
    props.exactDuplicateVersionId || props.nearDuplicateVersionId;
  const retryable =
    props.processingState === "FAILED" ||
    props.processingState === "NEEDS_ATTENTION";

  return (
    <section
      className="space-y-3 rounded-sm border border-[var(--border)] p-4"
      aria-labelledby="document-status-heading"
    >
      <h2 id="document-status-heading" className="text-lg font-medium">
        Private document status
      </h2>
      <dl className="grid gap-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium">File</dt>
          <dd>{props.displayFilename}</dd>
        </div>
        <div>
          <dt className="font-medium">Size</dt>
          <dd>{props.byteSize ? `${props.byteSize} bytes` : "Finalizing"}</dd>
        </div>
        <div>
          <dt className="font-medium">Malware scan</dt>
          <dd>{props.scanState.toLowerCase()}</dd>
        </div>
        <div>
          <dt className="font-medium">Processing</dt>
          <dd>
            {props.processingState.toLowerCase().replaceAll("_", " ")} · attempt{" "}
            {props.attempts}
          </dd>
        </div>
      </dl>
      {pending ? (
        <p role="status" aria-live="polite" className="text-sm">
          Scanning and extraction are running. This page refreshes for up to two
          minutes; durable processing continues if you leave.
        </p>
      ) : null}
      {props.safeErrorCode ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          Processing stopped safely ({props.safeErrorCode}). No unconfirmed
          content is visible to members.
        </p>
      ) : null}
      {props.issues.some((issue) => !issue.resolved) ? (
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Structural review</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {props.issues
              .filter((issue) => !issue.resolved)
              .map((issue) => (
                <li key={issue.id}>
                  {issue.safeMessage}
                  {issue.sectionLocator ? ` (${issue.sectionLocator})` : ""} [
                  {issue.severity.toLowerCase()}]
                </li>
              ))}
          </ul>
        </div>
      ) : null}
      {duplicate ? (
        <div className="space-y-2 rounded-sm border border-[var(--border)] p-3">
          <p className="text-sm">
            Possible {props.exactDuplicateVersionId ? "exact" : "near"}{" "}
            duplicate in this organization. It will not be merged or activated
            automatically.
          </p>
          {!props.duplicateAcknowledged ? (
            <form action={acknowledgeAction} className="space-y-2">
              <FormStatus status={ackState.status} message={ackState.message} />
              <HiddenFields {...props} />
              <SubmitButton pendingLabel="Acknowledging…">
                Acknowledge warning
              </SubmitButton>
            </form>
          ) : (
            <p className="text-xs text-[var(--muted)]">Warning acknowledged.</p>
          )}
        </div>
      ) : null}
      {retryable && props.scanState !== "INFECTED" ? (
        <form action={retryAction} className="space-y-2">
          <FormStatus status={retryState.status} message={retryState.message} />
          <HiddenFields {...props} />
          <SubmitButton pendingLabel="Queueing retry…">
            Retry processing
          </SubmitButton>
        </form>
      ) : null}
      <p className="flex flex-wrap gap-3 text-sm">
        <Link
          href={`/api/orgs/${encodeURIComponent(props.organizationSlug)}/knowledge/documents/${encodeURIComponent(props.versionId)}/download?sourceId=${encodeURIComponent(props.sourceId)}`}
          className="underline-offset-2 hover:underline"
        >
          Download original privately
        </Link>
        {props.processingState === "NEEDS_ATTENTION" ? (
          <Link
            href={`/app/orgs/${props.organizationSlug}/knowledge/${props.sourceId}/edit`}
            className="underline-offset-2 hover:underline"
          >
            Correct extracted draft
          </Link>
        ) : null}
      </p>
    </section>
  );
}

function HiddenFields(props: DocumentStatusProps) {
  return (
    <>
      <input
        type="hidden"
        name="organizationSlug"
        value={props.organizationSlug}
      />
      <input type="hidden" name="sourceId" value={props.sourceId} />
      <input type="hidden" name="versionId" value={props.versionId} />
    </>
  );
}
