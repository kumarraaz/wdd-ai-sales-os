"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthCard, AuthField, AuthPage } from "@/components/auth/AuthCard";
import { Button } from "@/components/ui/Button";
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
    <AuthPage>
      <AuthCard title="Forgot password">
        {sent ? (
          <p role="status" className="mt-3 text-sm leading-relaxed text-ink-muted">
            If an account exists for <span className="text-ink">{email}</span>, a reset link is on its way. Check your inbox.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <AuthField id="email" label="Email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            {error && (
              <p role="alert" className="text-sm text-red-300">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" block loading={loading}>
              {loading ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
        <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-neon-cyan hover:underline">
          Back to sign in
        </Link>
      </AuthCard>
    </AuthPage>
  );
}
