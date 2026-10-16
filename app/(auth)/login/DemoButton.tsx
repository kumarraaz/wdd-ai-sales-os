"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "View Demo" entry button for the login page. Rendered only when the server
 * determines demo mode is enabled — the client never reads DEMO_MODE itself.
 * The "or" divider is owned by LoginForm so it is shown once, not per button.
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
      <button
        type="button"
        onClick={enterDemo}
        disabled={busy}
        className="min-h-12 w-full rounded-xl border border-wdd-gold/40 bg-wdd-gold/10 px-4 py-3 text-sm font-semibold text-wdd-gold outline-none transition-colors hover:bg-wdd-gold/20 focus-visible:ring-2 focus-visible:ring-wdd-gold/60 disabled:cursor-not-allowed disabled:opacity-60"
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
