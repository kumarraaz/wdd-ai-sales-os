"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * Route-level error boundary for the authenticated app. It deliberately never
 * renders `error.message` (it can contain internals); the digest lets support
 * find the matching server log line.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] route error", error.digest ?? "(no digest)");
  }, [error]);

  return (
    <EmptyState
      icon={TriangleAlert}
      tone="red"
      title="This page couldn't load"
      description={
        <>
          Something went wrong on our side. Your data is safe — try again, or head back to the overview.
          {error.digest && (
            <span className="mt-2 block text-xs text-ink-dim">
              Reference: <code className="font-mono">{error.digest}</code>
            </span>
          )}
        </>
      }
      action={
        <>
          <Button variant="primary" onClick={reset}>
            <RotateCcw size={16} aria-hidden="true" /> Try again
          </Button>
          <ButtonLink href="/dashboard" variant="secondary">
            Back to overview
          </ButtonLink>
        </>
      }
    />
  );
}
