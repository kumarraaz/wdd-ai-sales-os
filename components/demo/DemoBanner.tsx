"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Persistent demo-mode banner. Rendered by the (app) layout only for valid
 * demo sessions — never in the real authenticated app.
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
      className="sticky top-0 z-50 border-b border-[#D4AF37]/50 bg-[#D4AF37] px-4 py-2"
    >
      <p className="text-center text-xs font-semibold tracking-wide text-black">
        DEMO MODE — Data and actions shown here are for demonstration only.
        <button
          onClick={exitDemo}
          disabled={busy}
          className="ml-3 rounded bg-black/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#D4AF37] transition hover:bg-black disabled:opacity-50"
        >
          {busy ? "Exiting…" : "Exit Demo"}
        </button>
      </p>
    </div>
  );
}
