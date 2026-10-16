"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Persistent demo-mode banner. Rendered by the (app) layout only for valid
 * demo sessions — never in the real authenticated app. It is part of the page flow
 * (not sticky) so it never covers the sticky top bar.
 */
export function DemoBanner() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function exitDemo() {
    setBusy(true);
    try {
      await fetch("/api/demo/exit", { method: "POST" });
    } finally {
      router.push("/login");
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-300/30 bg-amber-300/10 px-4 py-2 text-xs text-amber-200"
    >
      <p>
        <span className="font-semibold uppercase tracking-wider">Demo mode</span> — data and actions shown here are for
        demonstration only.
      </p>
      <button
        type="button"
        onClick={exitDemo}
        disabled={busy}
        className="min-h-9 rounded-control border border-amber-300/40 px-3 text-[11px] font-semibold uppercase tracking-wider text-amber-200 transition hover:bg-amber-300/15 disabled:opacity-50"
      >
        {busy ? "Exiting…" : "Exit demo"}
      </button>
    </div>
  );
}
