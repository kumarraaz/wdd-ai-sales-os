"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthCard, AuthField, AuthPage } from "@/components/auth/AuthCard";
import { Button } from "@/components/ui/Button";
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
    <AuthPage>
      <AuthCard title="Set a new password">
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <AuthField
            id="password"
            label="New password"
            hint="(min 8 characters)"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" block loading={loading}>
            {loading ? "Resetting…" : "Reset password"}
          </Button>
        </form>
        <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-neon-cyan hover:underline">
          Back to sign in
        </Link>
      </AuthCard>
    </AuthPage>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<div className="app-canvas flex min-h-dvh items-center justify-center text-ink-muted">Loading…</div>}>
      <ResetForm />
    </Suspense>
  );
}
