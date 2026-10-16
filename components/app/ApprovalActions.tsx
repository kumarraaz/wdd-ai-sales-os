/**
 * Review buttons for one pending approval.
 * Calls the secure POST APIs; the proposed action itself is never editable here —
 * approving runs exactly the stored snapshot the reviewer was shown.
 */
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";

type Action = "approve" | "reject" | "cancel";

export function ApprovalActions({ id, noun, effect }: { id: string; noun: string; effect: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  async function call(action: Action, body?: unknown) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/agent/approvals/${id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) {
        throw new Error(json.message || (res.status === 429 ? "Too many requests — wait a moment." : json.error) || "Request failed.");
      }
      // The list re-renders from the server; the outcome (executed / failed) is shown on the card.
      setRejecting(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onApprove() {
    const ok = await confirm({
      title: `Approve this ${noun}?`,
      description: effect,
      confirmLabel: "Approve",
    });
    if (ok) void call("approve");
  }

  async function onCancel() {
    const ok = await confirm({
      title: "Cancel this request?",
      description: "It is withdrawn and will never run. You can't undo this.",
      confirmLabel: "Cancel request",
      cancelLabel: "Keep it",
      tone: "danger",
    });
    if (ok) void call("cancel");
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="lime" loading={busy === "approve"} disabled={busy !== null} onClick={() => void onApprove()}>
          {busy === "approve" ? "Approving…" : "Approve"}
        </Button>
        <Button variant="danger" disabled={busy !== null} onClick={() => setRejecting(true)}>
          Reject
        </Button>
        <Button variant="ghost" loading={busy === "cancel"} disabled={busy !== null} onClick={() => void onCancel()}>
          Cancel request
        </Button>
      </div>
      {error && !rejecting && (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <Dialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        title={`Reject this ${noun}?`}
        description="It will not run. The reason is saved with the decision."
        dismissible={busy === null}
        footer={
          <>
            <Button variant="ghost" disabled={busy !== null} onClick={() => setRejecting(false)}>
              Back
            </Button>
            <Button variant="danger" loading={busy === "reject"} onClick={() => void call("reject", { reason: reason.trim() })}>
              Reject
            </Button>
          </>
        }
      >
        <label className="block text-xs text-ink-muted" htmlFor={`reject-reason-${id}`}>
          Reason (optional)
        </label>
        <textarea
          id={`reject-reason-${id}`}
          data-autofocus
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 2000))}
          rows={3}
          className="mt-1 w-full rounded-control border border-line bg-black/30 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-dim focus:border-neon-cyan"
          placeholder="e.g. Wrong audience, tone is off…"
        />
        {error && (
          <p role="alert" className="mt-2 text-xs text-red-300">
            {error}
          </p>
        )}
      </Dialog>
    </div>
  );
}
