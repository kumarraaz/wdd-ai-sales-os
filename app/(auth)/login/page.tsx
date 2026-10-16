import { Suspense } from "react";
import { isDemoModeEnabled } from "@/lib/demo";
import { LampLoginScene } from "./LampLoginScene";
import { LoginForm } from "./LoginForm";

// The flags below read runtime env; never freeze them into a build-time prerender.
export const dynamic = "force-dynamic";

/**
 * Server wrapper. Two flags are decided server-side and only booleans reach
 * the client:
 * - demo: DEMO_MODE is never exposed as an env var.
 * - google: shown only when the server actually has OAuth credentials — the
 *   same condition lib/auth.ts uses to register the provider — so the button
 *   can never appear for a provider that would fail.
 *
 * LampLoginScene is purely visual (lighting + reveal animation); the real form,
 * auth calls and redirect validation all live in LoginForm.
 */
export default function LoginPage() {
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  return (
    <LampLoginScene>
      <Suspense
        fallback={
          <div className="rounded-[20px] border border-wdd-line bg-wdd-card/90 p-9 text-center text-sm text-wdd-muted">
            Loading…
          </div>
        }
      >
        <LoginForm demoEnabled={isDemoModeEnabled()} googleEnabled={googleEnabled} />
      </Suspense>
    </LampLoginScene>
  );
}
