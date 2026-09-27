"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await authClient.requestPasswordReset(
      { email, redirectTo: "/reset" },
      { onSuccess: () => setSent(true) },
    );
    setLoading(false);
    if (error) setError(error.message || "Something went wrong.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0D1B2A] px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <h1 className="text-2xl font-bold text-white">Forgot password</h1>
        {sent ? (
          <p className="mt-3 text-sm text-white/60">
            If an account exists for <span className="text-white">{email}</span>, a reset link is
            on its way. Check your inbox.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="text-sm text-white/70">Email</label>
              <input
                id="email" type="email" required autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-[#D4AF37]"
              />
            </div>
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
            <button
              type="submit" disabled={loading}
              className="w-full rounded-lg bg-[#D4AF37] py-2.5 font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}
        <Link href="/login" className="mt-6 inline-block text-sm text-[#D4AF37] hover:underline">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
