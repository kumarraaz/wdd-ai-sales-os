"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await authClient.signUp.email(
      { email, password, name },
      { onSuccess: () => router.push("/dashboard") },
    );
    setLoading(false);
    if (error) setError(error.message || "Sign up failed. Try a different email.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0D1B2A] px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#D4AF37]">
          WDD AI Sales OS
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">Create your account</h1>
        <p className="mt-1 text-sm text-white/60">
          A personal workspace is created for you automatically.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="name" className="text-sm text-white/70">Name</label>
            <input
              id="name" type="text" required autoComplete="name"
              value={name} onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-[#D4AF37]"
            />
          </div>
          <div>
            <label htmlFor="email" className="text-sm text-white/70">Work email</label>
            <input
              id="email" type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-[#D4AF37]"
            />
          </div>
          <div>
            <label htmlFor="password" className="text-sm text-white/70">
              Password <span className="text-white/40">(min 8 characters)</span>
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
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-white/60">
          Already have an account?{" "}
          <Link href="/login" className="text-[#D4AF37] hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
