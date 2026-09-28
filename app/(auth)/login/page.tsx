import { Suspense } from "react";
import { isDemoModeEnabled } from "@/lib/demo";
import { LoginForm } from "./LoginForm";

/**
 * Server wrapper: decides (server-side only) whether the "View Demo" button
 * is shown. DEMO_MODE is never exposed to the client as an env var — only a
 * boolean prop reaches the form.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-white/50">Loading…</div>}>
      <LoginForm demoEnabled={isDemoModeEnabled()} />
    </Suspense>
  );
}
