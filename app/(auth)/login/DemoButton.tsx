"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "View Demo" entry button for the login page. Rendered only when the server
 * determines demo mode is enabled — the client never reads DEMO_MODE itself.
 */
export function DemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enterDemo() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/enter", { method: "POST" });
      if (!res.ok) throw new Error("Demo mode is not available.");
      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the demo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="my-4 flex items-center gap-3 text-xs text-white/40">
        <span className="h-px flex-1 bg-white/10" /> or{" "}
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <button
        onClick={enterDemo}
        disabled={busy}
        className="w-full rounded-lg border border-[#D4AF37]/50 bg-[#D4AF37]/10 py-2.5 text-sm font-semibold text-[#D4AF37] transition hover:bg-[#D4AF37]/20 disabled:opacity-50"
      >
        {busy ? "Starting demo…" : "View Demo"}
      </button>
      <p className="mt-2 text-center text-xs text-white/40">
        Explore the dashboard with sample data — no account needed.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-center text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
