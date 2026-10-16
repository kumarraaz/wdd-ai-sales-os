"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { safeNextPath } from "@/lib/safe-redirect";
import { DemoButton } from "./DemoButton";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClassName =
  "w-full rounded-xl border border-wdd-line bg-wdd-input px-4 py-3.5 text-base text-white " +
  "placeholder:text-white/30 outline-none transition-colors sm:text-sm " +
  "focus:border-wdd-gold/70 focus:ring-2 focus:ring-wdd-gold/10 " +
  "aria-[invalid=true]:border-red-400/60";

const labelClassName = "block text-[11px] font-medium uppercase tracking-[0.2em] text-wdd-muted";

type FieldErrors = { email?: string; password?: string };

/** Staged reveal: each block fades up in turn once the scene reaches phase "card" (see globals.css). */
function reveal(index: number, extra = "") {
  return {
    className: `lamp-item ${extra}`.trim(),
    style: { transitionDelay: `${150 + index * 100}ms` },
  };
}

/**
 * Sign-in card. Authentication is unchanged: it calls the existing better-auth
 * client (`authClient.signIn.email`), which hits /api/auth/* where CSRF
 * (trustedOrigins), rate limiting and HttpOnly session cookies are enforced
 * server-side. Nothing credential-related is stored in the browser by this form.
 */
export function LoginForm({
  demoEnabled,
  googleEnabled,
}: {
  demoEnabled: boolean;
  googleEnabled: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  // Validated every time: `next` is attacker-controllable via the URL.
  const nextPath = safeNextPath(searchParams.get("next"));
  const busy = loading || googleBusy;

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    const trimmed = email.trim();
    if (!trimmed) errors.email = "Enter your email address.";
    else if (!EMAIL_PATTERN.test(trimmed)) errors.email = "Enter a valid email address.";
    if (!password) errors.password = "Enter your password.";
    return errors;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    const errors = validate();
    setFieldErrors(errors);
    if (errors.email) return emailRef.current?.focus();
    if (errors.password) return passwordRef.current?.focus();

    setLoading(true);
    try {
      const { error: authError } = await authClient.signIn.email({
        email: email.trim(),
        password,
        rememberMe,
      });
      if (authError) {
        // Never echo server text: keep one generic message for bad credentials
        // so the form cannot be used to probe which emails have accounts.
        if (authError.status === 429) {
          setError("Too many attempts. Please wait a minute and try again.");
        } else if ((authError.status ?? 0) >= 500) {
          setError("Something went wrong on our side. Please try again.");
        } else {
          setError("Incorrect email or password.");
        }
        setLoading(false);
        return;
      }
      // Keep the button disabled while navigating to avoid a double submit.
      router.push(nextPath);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setLoading(false);
    }
  }

  async function googleSignIn() {
    if (busy) return;
    setError(null);
    setGoogleBusy(true);
    try {
      const { error: socialError } = await authClient.signIn.social({
        provider: "google",
        callbackURL: nextPath,
      });
      if (socialError) {
        setError("Google sign-in failed. Please try again.");
        setGoogleBusy(false);
      }
      // On success the browser is redirected to Google; leave the button busy.
    } catch {
      setError("Google sign-in failed. Please try again.");
      setGoogleBusy(false);
    }
  }

  return (
    <div className="rounded-[20px] border border-wdd-line bg-wdd-card/90 p-6 shadow-2xl shadow-black/40 backdrop-blur-md sm:p-9">
      <div {...reveal(0)}>
        <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-wdd-gold">WDD SALES OS</p>
        <h1 className="mt-5 font-serif text-[2.125rem] leading-tight tracking-tight text-wdd-text sm:text-[2.5rem]">
          Welcome back.
        </h1>
        <p className="mt-3 text-sm text-wdd-muted">Let&apos;s grow your business.</p>
      </div>

      <form onSubmit={onSubmit} noValidate aria-busy={loading} className="mt-8 space-y-5">
        <div {...reveal(1)}>
          <label htmlFor="email" className={labelClassName}>Email</label>
          <input
            ref={emailRef}
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
            className={`mt-2 ${inputClassName}`}
          />
          {fieldErrors.email && (
            <p id="email-error" className="mt-1.5 text-sm text-red-400">{fieldErrors.email}</p>
          )}
        </div>

        <div {...reveal(2)}>
          <label htmlFor="password" className={labelClassName}>Password</label>
          <div className="relative mt-2">
            <input
              ref={passwordRef}
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              maxLength={128}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={fieldErrors.password ? "password-error" : undefined}
              className={`${inputClassName} pr-20`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              aria-controls="password"
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex min-w-[4.5rem] items-center justify-center rounded-r-xl text-[11px] font-semibold uppercase tracking-[0.18em] text-wdd-muted outline-none transition-colors hover:text-white focus-visible:text-wdd-gold focus-visible:ring-2 focus-visible:ring-wdd-gold/40"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {fieldErrors.password && (
            <p id="password-error" className="mt-1.5 text-sm text-red-400">{fieldErrors.password}</p>
          )}
        </div>

        <div {...reveal(3, "space-y-5")}>
          <div className="flex items-center justify-between gap-4 text-sm">
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-white/70">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded accent-[#D4AF37] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wdd-gold"
              />
              Remember me
            </label>
            <Link
              href="/forgot"
              className="inline-flex min-h-11 items-center rounded text-wdd-muted outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-wdd-gold/50"
            >
              Forgot password?
            </Link>
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="min-h-12 w-full rounded-xl bg-gradient-to-b from-[#F7AE55] to-[#E8862A] px-4 py-3 text-sm font-semibold text-[#1A1006] outline-none transition hover:shadow-[0_0_28px_rgba(245,154,53,0.35)] focus-visible:ring-2 focus-visible:ring-wdd-gold focus-visible:ring-offset-2 focus-visible:ring-offset-wdd-card disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-none motion-reduce:transition-none"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>

      <div {...reveal(4)}>
        {(googleEnabled || demoEnabled) && (
          <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.3em] text-white/40">
            <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
          </div>
        )}

        <div className="space-y-3">
          {googleEnabled && (
            <button
              type="button"
              onClick={googleSignIn}
              disabled={busy}
              className="min-h-12 w-full rounded-xl border border-wdd-line bg-white/[0.03] px-4 py-3 text-sm font-medium text-white outline-none transition-colors hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-wdd-gold/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {googleBusy ? "Redirecting to Google…" : "Continue with Google"}
            </button>
          )}
          {demoEnabled && <DemoButton />}
        </div>

        <p className="mt-8 text-center text-sm text-wdd-muted">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="rounded font-medium text-wdd-gold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-wdd-gold/50"
          >
            Create account
          </Link>
        </p>
      </div>
    </div>
  );
}
