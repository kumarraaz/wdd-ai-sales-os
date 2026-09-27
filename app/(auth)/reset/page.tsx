"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

function ResetForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setError("This reset link is missing its token.");
      return;
    }
    setError(null);
    setLoading(true);
    const { error } = await authClient.resetPassword(
      { newPassword: password, token },
      { onSuccess: () => router.push("/login") },
    );
    setLoading(false);
    if (error) setError(error.message || "Reset failed. The link may have expired.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0D1B2A] px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <h1 className="text-2xl font-bold text-white">Set a new password</h1>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="password" className="text-sm text-white/70">
              New password <span className="text-white/40">(min 8 characters)</span>
            </label>
            <input
              id="password" type="password" required minLength={8} autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-[#D4AF37]"
            />
          </div>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full rounded-lg bg-[#D4AF37] py-2.5 font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {loading ? "Resetting…" : "Reset password"}
          </button>
        </form>
        <Link href="/login" className="mt-6 inline-block text-sm text-[#D4AF37] hover:underline">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-white/50">Loading…</div>}>
      <ResetForm />
    </Suspense>
  );
}
