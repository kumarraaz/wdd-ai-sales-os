"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { DemoButton } from "./DemoButton";

const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_OAUTH === "true";

export function LoginForm({ demoEnabled }: { demoEnabled: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await authClient.signIn.email(
      { email, password },
      {
        onSuccess: () => router.push(searchParams.get("next") || "/dashboard"),
      },
    );
    setLoading(false);
    if (error) setError(error.message || "Sign in failed. Check your credentials.");
  }

  async function googleSignIn() {
    setError(null);
    await authClient.signIn.social(
      { provider: "google", callbackURL: "/dashboard" },
      { onError: (ctx) => setError(ctx.error.message || "Google sign-in failed.") },
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0D1B2A] px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#D4AF37]">
          WDD AI Sales OS
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">Sign in</h1>
        <p className="mt-1 text-sm text-white/60">Welcome back to your sales pipeline.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="text-sm text-white/70">Email</label>
            <input
              id="email" type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-[#D4AF37]"
            />
          </div>
          <div>
            <label htmlFor="password" className="text-sm text-white/70">Password</label>
            <input
              id="password" type="password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-[#D4AF37]"
            />
          </div>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full rounded-lg bg-[#D4AF37] py-2.5 font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {demoEnabled && <DemoButton />}

        {googleEnabled && (
          <>
            <div className="my-4 flex items-center gap-3 text-xs text-white/40">
              <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
            </div>
            <button
              onClick={googleSignIn}
              className="w-full rounded-lg border border-white/15 py-2.5 text-sm font-medium text-white transition hover:bg-white/5"
            >
              Continue with Google
            </button>
          </>
        )}

        <div className="mt-6 flex items-center justify-between text-sm">
          <Link href="/signup" className="text-[#D4AF37] hover:underline">Create account</Link>
          <Link href="/forgot" className="text-white/60 hover:text-white">Forgot password?</Link>
        </div>
      </div>
    </div>
  );
}
