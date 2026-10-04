/**
 * Client-side review buttons for one approval.
 * Calls the secure POST APIs; the proposed action itself is never editable here.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ApprovalActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(action: "approve" | "reject" | "cancel", body?: unknown) {
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
        throw new Error(json.message || json.error || "Request failed.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(null);
    }
  }

  const onReject = () => {
    const reason = window.prompt("Rejection reason (optional):", "");
    if (reason === null) return; // user cancelled the prompt
    void call("reject", { reason });
  };

  const btn =
    "rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        className={`${btn} bg-emerald-500/90 text-white hover:bg-emerald-500`}
        disabled={busy !== null}
        onClick={() => void call("approve")}
      >
        {busy === "approve" ? "Approving…" : "Approve"}
      </button>
      <button
        className={`${btn} bg-red-500/20 text-red-300 hover:bg-red-500/30`}
        disabled={busy !== null}
        onClick={onReject}
      >
        {busy === "reject" ? "Rejecting…" : "Reject"}
      </button>
      <button
        className={`${btn} bg-white/10 text-white/70 hover:bg-white/20`}
        disabled={busy !== null}
        onClick={() => void call("cancel")}
      >
        {busy === "cancel" ? "Cancelling…" : "Cancel"}
      </button>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </div>
  );
}
