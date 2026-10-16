"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthCard, AuthField, AuthPage } from "@/components/auth/AuthCard";
import { Button } from "@/components/ui/Button";
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
    <AuthPage>
      <AuthCard title="Create your account" description="A personal workspace is created for you automatically.">
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <AuthField id="name" label="Name" type="text" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          <AuthField id="email" label="Work email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <AuthField
            id="password"
            label="Password"
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
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-neon-cyan hover:underline">
            Sign in
          </Link>
        </p>
      </AuthCard>
    </AuthPage>
  );
}
