import { Compass } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export default function AppNotFound() {
  return (
    <EmptyState
      icon={Compass}
      tone="violet"
      title="We couldn't find that"
      description="The page or record doesn't exist, or it belongs to another workspace."
      action={
        <>
          <ButtonLink href="/dashboard" variant="primary">
            Back to overview
          </ButtonLink>
          <ButtonLink href="/leads" variant="secondary">
            Browse leads
          </ButtonLink>
        </>
      }
    />
  );
}
