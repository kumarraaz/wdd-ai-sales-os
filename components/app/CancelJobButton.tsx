"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";

/** Cancels a queued/retrying job through the role-checked, audited jobs API. Running jobs cannot be cancelled. */
export function CancelJobButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    const ok = await confirm({
      title: `Cancel “${label}”?`,
      description: "It won't run. A job that has already started can't be cancelled.",
      confirmLabel: "Cancel job",
      cancelLabel: "Keep it",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/automation/jobs/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (res.status === 409) throw new Error("It already started or finished, so it can't be cancelled.");
      if (res.status === 403) throw new Error("Your role can't cancel jobs.");
      if (!res.ok) throw new Error("Could not cancel the job.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel the job.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button variant="ghost" size="sm" loading={busy} onClick={() => void cancel()}>
        Cancel
      </Button>
      {error && (
        <p role="alert" className="mt-1 max-w-48 text-[11px] text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
