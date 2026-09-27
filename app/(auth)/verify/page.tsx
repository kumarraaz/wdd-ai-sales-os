"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

/** Landing target for email verification links. */
function VerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<"verifying" | "done" | "error">("verifying");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setState("error");
      setMessage("This verification link is missing its token.");
      return;
    }
    authClient.verifyEmail(
      { query: { token } },
      {
        onSuccess: () => {
          setState("done");
          setTimeout(() => router.push("/app/dashboard"), 1500);
        },
        onError: (ctx) => {
          setState("error");
          setMessage(ctx.error.message || "Verification failed or the link expired.");
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0D1B2A] px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur">
        {state === "verifying" && (
          <>
            <h1 className="text-xl font-bold text-white">Verifying your email…</h1>
            <p className="mt-2 text-sm text-white/60">This takes a few seconds.</p>
          </>
        )}
        {state === "done" && (
          <>
            <h1 className="text-xl font-bold text-white">Verified ✓</h1>
            <p className="mt-2 text-sm text-white/60">Taking you to your dashboard…</p>
          </>
        )}
        {state === "error" && (
          <>
            <h1 className="text-xl font-bold text-white">Verification failed</h1>
            <p className="mt-2 text-sm text-red-400">{message}</p>
            <Link href="/login" className="mt-6 inline-block text-sm text-[#D4AF37] hover:underline">
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-white/50">Loading…</div>}>
      <VerifyForm />
    </Suspense>
  );
}
