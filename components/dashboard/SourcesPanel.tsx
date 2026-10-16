import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { TONE } from "@/components/ui/tone";
import { cn, stagger } from "@/lib/cn";
import { sourceStatus } from "@/lib/source-status";

/** Which discovery providers the next run can use, with an honest status word (never colour alone). */
export function SourcesPanel({
  sources,
  demo,
}: {
  sources: { id: string; label: string; availability: string }[];
  demo: boolean;
}) {
  return (
    <Card aria-labelledby="sources-title" className="rise-in" style={stagger(8)}>
      <CardHeader
        id="sources-title"
        title="Discovery sources"
        description="What your next run can use"
        actions={
          !demo && (
            <Link href="/integrations" className="text-xs font-semibold text-neon-cyan hover:underline">
              Manage →
            </Link>
          )
        }
      />
      {sources.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">
          {demo ? "Sources aren't connected in demo mode." : "Source status is unavailable right now."}
        </p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-2">
          {sources.map((s) => {
            const st = sourceStatus(s.availability);
            return (
              <li
                key={s.id}
                className="inline-flex min-h-8 items-center gap-2 rounded-control border border-line bg-surface-2 px-3 text-xs text-ink"
              >
                <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", TONE[st.tone].solid)} />
                <span>{s.label}</span>
                <span className="text-ink-muted">· {st.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
