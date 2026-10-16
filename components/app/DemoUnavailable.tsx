import { FlaskConical } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

/** Shown instead of a page that needs a real workspace (it never fakes data in demo mode). */
export function DemoUnavailable({ what, children }: { what: string; children?: React.ReactNode }) {
  return (
    <EmptyState
      icon={FlaskConical}
      tone="amber"
      title={`${what} isn't available in demo mode`}
      description={
        children ?? "Demo mode shows fictional sample data only. Create an account to use this with your own workspace."
      }
      action={
        <ButtonLink href="/dashboard" variant="secondary">
          Back to dashboard
        </ButtonLink>
      }
    />
  );
}
