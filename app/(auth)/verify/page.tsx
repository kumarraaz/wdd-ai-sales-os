"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthCard, AuthPage } from "@/components/auth/AuthCard";
import { authClient } from "@/lib/auth-client";

/** Landing target for email verification links. */
function VerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Read the token during render so the missing-token case never needs a
  // synchronous setState inside the effect (react-hooks/set-state-in-effect).
  const token = searchParams.get("token");
  const [state, setState] = useState<"verifying" | "done" | "error">(
    token ? "verifying" : "error",
  );
  const [message, setMessage] = useState(
    token ? "" : "This verification link is missing its token.",
  );

  useEffect(() => {
    if (!token) return;
    authClient.verifyEmail(
      { query: { token } },
      {
        onSuccess: () => {
          setState("done");
          // (app) routes live at /dashboard — route groups add no "/app" URL segment.
          setTimeout(() => router.push("/dashboard"), 1500);
        },
        onError: (ctx) => {
          setState("error");
          setMessage(ctx.error.message || "Verification failed or the link expired.");
        },
      },
    );
  }, [token, router]);

  return (
    <AuthPage>
      {state === "verifying" && (
        <AuthCard align="center" title="Verifying your email…" description="This takes a few seconds." />
      )}
      {state === "done" && (
        <AuthCard align="center" title="Verified ✓" description="Taking you to your dashboard…" />
      )}
      {state === "error" && (
        <AuthCard align="center" title="Verification failed">
          <p role="alert" className="mt-2 text-sm text-red-300">
            {message}
          </p>
          <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-neon-cyan hover:underline">
            Back to sign in
          </Link>
        </AuthCard>
      )}
    </AuthPage>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="app-canvas flex min-h-dvh items-center justify-center text-ink-muted">Loading…</div>}>
      <VerifyForm />
    </Suspense>
  );
}
