import type { Metadata } from "next";
import { CheckCircle2, Circle, Megaphone } from "lucide-react";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { stagger } from "@/lib/cn";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaigns" };

const TODAY = [
  { title: "Find prospects", body: "Discovery pulls real businesses from the sources you connect, with the source of every field.", href: "/discover", cta: "Open Discover" },
  { title: "Understand them", body: "Website intelligence and lead scoring show who is worth contacting, and why.", href: "/intelligence", cta: "Open Intelligence" },
  { title: "Draft with a person in control", body: "Drafts stop in the Approval queue. Nothing is sent to a prospect until you act.", href: "/approvals", cta: "Open the Approval queue" },
  { title: "Reach out by hand", body: "The Instagram outreach assistant prepares messages that you review and send yourself.", href: "/outreach/instagram", cta: "Open Outreach studio" },
];

const PLANNED = [
  "A campaign builder: audience, channels and a daily sending limit",
  "Multi-step sequences with delays between steps",
  "Per-campaign results (replies, meetings) from real activity",
  "Enrolling leads from a list or a saved filter",
];

/**
 * Campaigns are on the roadmap, not built. This page says so plainly and points at what
 * works today — it shows no campaign data, because none exists.
 */
export default async function CampaignsPage() {
  const ctx = await getPageContext();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="Multi-step outreach campaigns are planned, not available yet. Here is what you can do today."
        badge={ctx.demo ? <DemoBadge /> : <Badge tone="violet">Planned</Badge>}
      />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card aria-labelledby="today-title" className="rise-in" style={stagger(1)}>
          <CardHeader id="today-title" title="What works today" description="The path from prospect to approved draft" />
          <ol className="mt-4 space-y-3">
            {TODAY.map((s, i) => (
              <li key={s.title} className="flex gap-3 rounded-control border border-line bg-surface-2/60 p-3.5">
                <span
                  aria-hidden="true"
                  className="tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neon-cyan/40 bg-neon-cyan/10 text-xs font-semibold text-neon-cyan"
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                    <CheckCircle2 size={14} aria-hidden="true" className="text-neon-lime" />
                    {s.title}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{s.body}</p>
                  {!ctx.demo && (
                    <ButtonLink href={s.href} variant="ghost" size="sm" className="-ml-3 mt-1">
                      {s.cta} →
                    </ButtonLink>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card aria-labelledby="planned-title" tone="violet" className="rise-in" style={stagger(2)}>
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-neon-violet/30 bg-neon-violet/10 text-neon-violet"
            >
              <Megaphone size={20} />
            </span>
            <div>
              <h2 id="planned-title" className="text-[17px] font-semibold text-ink">
                On the roadmap
              </h2>
              <p className="text-[11px] text-ink-muted">Not built yet — no dates promised</p>
            </div>
          </div>
          <ul className="mt-4 space-y-2.5">
            {PLANNED.map((p) => (
              <li key={p} className="flex gap-2.5 text-sm text-ink-muted">
                <Circle size={14} aria-hidden="true" className="mt-1 shrink-0 text-neon-violet" />
                {p}
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-line pt-3 text-xs text-ink-muted">
            When campaigns arrive they will follow the same rule as everything else: a person approves outbound messages
            before anything is sent.
          </p>
        </Card>
      </div>
    </div>
  );
}
