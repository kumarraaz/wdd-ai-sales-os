import { Suspense } from "react";
import { isDemoModeEnabled } from "@/lib/demo";
import { LoginForm } from "./LoginForm";
import { LoginBrandHeader, LoginVisual } from "./LoginVisual";

// The flags below read runtime env; never freeze them into a build-time prerender.
export const dynamic = "force-dynamic";

/**
 * Server wrapper. Two flags are decided server-side and only booleans reach
 * the client:
 * - demo: DEMO_MODE is never exposed as an env var.
 * - google: shown only when the server actually has OAuth credentials — the
 *   same condition lib/auth.ts uses to register the provider — so the button
 *   can never appear for a provider that would fail.
 */
export default function LoginPage() {
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  return (
    <main className="relative min-h-dvh overflow-hidden bg-wdd-bg text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(245,154,53,0.10),transparent_45%)]" />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-7xl items-center px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] sm:px-8 lg:px-12">
        <div className="grid w-full items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <LoginVisual />

          <section className="mx-auto w-full max-w-md">
            <LoginBrandHeader />
            <Suspense
              fallback={
                <div className="rounded-3xl border border-wdd-line bg-wdd-card/95 p-9 text-center text-sm text-wdd-muted">
                  Loading…
                </div>
              }
            >
              <LoginForm demoEnabled={isDemoModeEnabled()} googleEnabled={googleEnabled} />
            </Suspense>
            <p className="mt-6 text-center text-xs text-white/40">
              Secure access to your sales workspace.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
