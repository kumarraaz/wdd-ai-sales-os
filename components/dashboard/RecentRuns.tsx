import Link from "next/link";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { stagger } from "@/lib/cn";
import type { RecentRun } from "@/lib/dashboard-data";
import { runStatus } from "@/lib/source-status";

const th = "whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted";
const td = "px-3 py-2.5 align-middle text-xs text-ink";

/** The last discovery runs for this workspace, newest first. */
export function RecentRuns({ runs, demo }: { runs: RecentRun[]; demo: boolean }) {
  return (
    <Card aria-labelledby="runs-title" className="rise-in" style={stagger(7)}>
      <CardHeader
        id="runs-title"
        title="Recent discovery runs"
        description="What each run found and imported"
        actions={
          !demo && (
            <Link href="/discover/history" className="text-xs font-semibold text-neon-cyan hover:underline">
              View all →
            </Link>
          )
        }
      />
      {runs.length === 0 ? (
        <EmptyState
          icon={Search}
          tone="muted"
          className="mt-4 py-8"
          title="No discovery runs yet"
          description={
            demo
              ? "Discovery runs aren't recorded in demo mode."
              : "Each run lists how many businesses were found, contactable and imported."
          }
          action={
            <ButtonLink href="/discover" variant="secondary" size="sm">
              Open Discover
            </ButtonLink>
          }
        />
      ) : (
        <div
          role="region"
          aria-label="Recent discovery runs (scrolls sideways on small screens)"
          tabIndex={0}
          className="-mx-5 mt-3 overflow-x-auto px-5"
        >
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={th}>Run</th>
                <th scope="col" className={`${th} text-right`}>Found</th>
                <th scope="col" className={`${th} text-right`}>Contactable</th>
                <th scope="col" className={`${th} text-right`}>Imported</th>
                <th scope="col" className={th}>Status</th>
                <th scope="col" className={th}>Date</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const status = runStatus(r.status);
                return (
                  <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-tint/5">
                    <td className={`${td} max-w-[260px]`}>
                      <span className="block truncate font-medium" title={r.label}>
                        {r.label}
                      </span>
                      <span className="block truncate text-[11px] text-ink-muted">
                        {Array.isArray(r.providerIds) && r.providerIds.length > 0
                          ? r.providerIds.join(", ")
                          : "No source recorded"}
                        {" · "}asked for {r.requested.toLocaleString("en-IN")}
                      </span>
                    </td>
                    <td className={`${td} tnum text-right`}>{r.discovered.toLocaleString("en-IN")}</td>
                    <td className={`${td} tnum text-right`}>{r.contactable.toLocaleString("en-IN")}</td>
                    <td className={`${td} tnum text-right font-semibold`}>{r.imported.toLocaleString("en-IN")}</td>
                    <td className={td}>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td className={`${td} whitespace-nowrap text-ink-muted`}>
                      <time dateTime={r.createdAt.toISOString()}>
                        {r.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}
                      </time>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
