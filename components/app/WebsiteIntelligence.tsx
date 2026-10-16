"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface Findings {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  redirectChain: { url: string; status: number }[];
  https: boolean;
  responseTimeMs: number;
  htmlAvailable: boolean;
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  robotsMeta: string | null;
  viewportMeta: string | null;
  h1: { count: number; texts: string[] };
  h2Count: number;
  imageCount: number;
  imagesMissingAlt: number;
  internalLinkCount: number;
  externalLinkCount: number;
  robotsTxt: { available: boolean; url: string };
  sitemap: { available: boolean; url: string };
  favicon: { available: boolean; href: string | null };
  openGraph: { title: string | null; description: string | null; image: string | null };
  twitterCard: { card: string | null; title: string | null; description: string | null; image: string | null };
  lang: string | null;
  structuredData: { jsonLdCount: number; microdata: boolean; present: boolean };
  mobile: { viewportPresent: boolean; responsiveSignal: boolean };
  techSignals: { signal: string; evidence: string; provenance: string }[];
  contact: { emails: string[]; phones: string[] };
  socialLinks: { platform: string; url: string }[];
  provenance: string;
  inspectedAt: string;
}

interface Inspection {
  id: string;
  requestedUrl: string;
  finalUrl: string | null;
  httpStatus: number | null;
  status: string;
  error: string | null;
  dataLabel: string;
  inspectedAt: string;
  findings: Findings | Record<string, never>;
  lead?: { id: string; fullName: string | null; website: string | null } | null;
}

interface IntelligenceProps {
  apiBase: string;
  demo?: boolean;
}

const inputCls =
  "w-full rounded-lg border border-line bg-black/30 px-3 py-2 text-sm text-ink outline-none focus:border-neon-cyan";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start">
      <dt className="w-44 shrink-0 text-xs font-medium uppercase tracking-wide text-ink-dim">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm text-ink">{children}</dd>
    </div>
  );
}

function YesNo({ value, yes = "Yes", no = "No" }: { value: boolean; yes?: string; no?: string }) {
  return (
    <span className={value ? "text-neon-lime" : "text-ink-dim"}>
      {value ? yes : no}
    </span>
  );
}

function Missing({ text = "Not found in inspected page" }: { text?: string }) {
  return <span className="text-ink-dim">— <span className="text-xs">{text}</span></span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-black/20 p-4">
      <h3 className="mb-1 text-sm font-semibold text-neon-cyan">{title}</h3>
      <dl className="divide-y divide-line/60">{children}</dl>
    </div>
  );
}

function provenanceBadge(provenance: string) {
  const isDemo = provenance === "DEMO_DATA";
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold ${
        isDemo ? "bg-neon-cyan/15 text-neon-cyan" : "bg-neon-lime/15 text-neon-lime"
      }`}
      title={`Data provenance: ${provenance}`}
    >
      {isDemo ? "Demo data" : "Verified data"}
    </span>
  );
}

function FindingsView({ findings }: { findings: Findings }) {
  const f = findings;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {provenanceBadge(f.provenance)}
        <span className="text-xs text-ink-dim">
          Inspected {new Date(f.inspectedAt).toLocaleString()}
        </span>
        <span className="break-all text-xs text-ink-dim">{f.finalUrl}</span>
      </div>

      <Section title="Website status">
        <Row label="HTTP status">
          <span className={f.httpStatus >= 200 && f.httpStatus < 300 ? "text-neon-lime" : "text-amber-300"}>
            {f.httpStatus}
          </span>
        </Row>
        <Row label="HTTPS">
          <YesNo value={f.https} />
        </Row>
        <Row label="Response time">{f.responseTimeMs} ms</Row>
        <Row label="Final URL">
          <span className="break-all">{f.finalUrl}</span>
        </Row>
        {f.redirectChain.length > 0 && (
          <Row label="Redirect chain">
            <ol className="list-decimal space-y-1 pl-4">
              {f.redirectChain.map((h, i) => (
                <li key={i} className="break-all">
                  <span className="text-ink-muted">{h.status} → </span>
                  {h.url}
                </li>
              ))}
            </ol>
          </Row>
        )}
      </Section>

      <Section title="SEO basics">
        <Row label="Title">{f.title ?? <Missing />}</Row>
        <Row label="Meta description">{f.metaDescription ?? <Missing />}</Row>
        <Row label="Canonical">{f.canonicalUrl ?? <Missing />}</Row>
        <Row label="Robots meta">{f.robotsMeta ?? <Missing text="No robots meta tag" />}</Row>
        <Row label="Language">{f.lang ?? <Missing text="No lang attribute" />}</Row>
      </Section>

      <Section title="Content structure">
        <Row label="H1">
          {f.h1.count === 0 ? (
            <Missing text="No H1 in inspected page" />
          ) : (
            <span>
              {f.h1.count} — {f.h1.texts.join(" · ")}
            </span>
          )}
        </Row>
        <Row label="H2 count">{f.h2Count}</Row>
        <Row label="Images">
          {f.imageCount} total ·{" "}
          <span className={f.imagesMissingAlt > 0 ? "text-amber-300" : ""}>
            {f.imagesMissingAlt} missing alt
          </span>
        </Row>
        <Row label="Links">
          {f.internalLinkCount} internal · {f.externalLinkCount} external
        </Row>
        <Row label="Viewport meta">
          {f.viewportMeta ?? <Missing text="No viewport meta tag" />}
        </Row>
      </Section>

      <Section title="Discoverability">
        <Row label="robots.txt">
          <YesNo value={f.robotsTxt.available} yes="Found" no="Not found" />{" "}
          <span className="text-xs text-ink-dim">{f.robotsTxt.url}</span>
        </Row>
        <Row label="sitemap.xml">
          <YesNo value={f.sitemap.available} yes="Found" no="Not found" />{" "}
          <span className="text-xs text-ink-dim">{f.sitemap.url}</span>
        </Row>
        <Row label="Favicon">
          <YesNo value={f.favicon.available} yes="Found" no="Not found" />
          {f.favicon.href && (
            <span className="ml-2 text-xs text-ink-dim">{f.favicon.href}</span>
          )}
        </Row>
        <Row label="Structured data">
          {f.structuredData.present ? (
            <span>
              {f.structuredData.jsonLdCount > 0 &&
                `${f.structuredData.jsonLdCount} JSON-LD block${f.structuredData.jsonLdCount === 1 ? "" : "s"}`}
              {f.structuredData.jsonLdCount > 0 && f.structuredData.microdata && " · "}
              {f.structuredData.microdata && "Microdata (itemscope) present"}
            </span>
          ) : (
            <Missing text="No JSON-LD or microdata in inspected page" />
          )}
        </Row>
      </Section>

      <Section title="Social metadata">
        <Row label="Open Graph">
          {f.openGraph.title || f.openGraph.description || f.openGraph.image ? (
            <span>
              {[f.openGraph.title, f.openGraph.description].filter(Boolean).join(" — ")}
            </span>
          ) : (
            <Missing text="No Open Graph tags" />
          )}
        </Row>
        <Row label="Twitter card">
          {f.twitterCard.card ? (
            <span>
              {f.twitterCard.card}
              {f.twitterCard.title ? ` — ${f.twitterCard.title}` : ""}
            </span>
          ) : (
            <Missing text="No Twitter card tags" />
          )}
        </Row>
        <Row label="Mobile signal">
          {f.mobile.viewportPresent ? (
            <span>
              Viewport present
              {f.mobile.responsiveSignal && (
                <span className="text-neon-lime"> · width=device-width detected</span>
              )}
            </span>
          ) : (
            <Missing text="No viewport meta tag" />
          )}
        </Row>
      </Section>

      <Section title="Technology signals">
        {f.techSignals.length === 0 ? (
          <p className="py-2 text-sm text-ink-dim">
            No reliable CMS/framework patterns detected in the inspected HTML.
          </p>
        ) : (
          <ul className="space-y-2 py-1">
            {f.techSignals.map((t, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium text-ink">{t.signal}</span>{" "}
                <span className="rounded bg-neon-violet/15 px-1.5 py-0.5 text-[10px] font-semibold text-neon-violet">
                  AI inference
                </span>
                <div className="text-xs text-ink-dim">{t.evidence}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Public contact & social">
        <Row label="Emails">
          {f.contact.emails.length > 0 ? (
            f.contact.emails.join(", ")
          ) : (
            <Missing text="No mailto: links in inspected page" />
          )}
        </Row>
        <Row label="Phones">
          {f.contact.phones.length > 0 ? (
            f.contact.phones.join(", ")
          ) : (
            <Missing text="No tel: links in inspected page" />
          )}
        </Row>
        <Row label="Social links">
          {f.socialLinks.length > 0 ? (
            <ul className="space-y-1">
              {f.socialLinks.map((s, i) => (
                <li key={i}>
                  <span className="text-ink-muted">{s.platform}: </span>
                  <span className="break-all text-neon-blue">{s.url}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Missing text="No social profile links in inspected page" />
          )}
        </Row>
      </Section>
    </div>
  );
}

interface EvidenceRefView {
  sourceType: string;
  field: string;
}

interface InferenceItem {
  type: string;
  statement: string;
  evidence: EvidenceRefView[];
}

interface AIIntelligenceData {
  summary: { text: string; evidence: EvidenceRefView[] };
  businessType: string;
  verifiedSignals: InferenceItem[];
  inferredOpportunities: InferenceItem[];
  recommendedServices: InferenceItem[];
  salesAngle: { text: string; evidence: EvidenceRefView[] };
  discoveryQuestions: string[];
  confidence: string;
  confidenceReason: string;
  evidence: EvidenceRefView[];
}

interface AIIntelligenceRecord {
  id: string;
  status: string;
  provider: string;
  model: string | null;
  confidence: string | null;
  generatedAt: string;
  warnings: string[];
  error: string | null;
  dataLabel?: string;
  intelligence: AIIntelligenceData | Record<string, never>;
}

function EvidenceChips({ refs }: { refs: EvidenceRefView[] }) {
  if (refs.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {refs.map((r, i) => (
        <span
          key={i}
          className="rounded bg-tint/5 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim"
          title={`Evidence: ${r.sourceType} · ${r.field}`}
        >
          {r.sourceType}.{r.field}
        </span>
      ))}
    </div>
  );
}

function typeBadge(type: string) {
  const verified = type === "VERIFIED_DATA";
  return (
    <span
      className={`mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        verified ? "bg-neon-lime/15 text-neon-lime" : "bg-neon-violet/15 text-neon-violet"
      }`}
    >
      {verified ? "Verified data" : "AI inference"}
    </span>
  );
}

function InferenceList({ items }: { items: InferenceItem[] }) {
  if (items.length === 0) {
    return <p className="py-2 text-sm text-ink-dim">None identified from the available evidence.</p>;
  }
  return (
    <ul className="space-y-3 py-1">
      {items.map((item, i) => (
        <li key={i} className="text-sm text-ink">
          <div>
            {typeBadge(item.type)}
            {item.statement}
          </div>
          <EvidenceChips refs={item.evidence} />
        </li>
      ))}
    </ul>
  );
}

function confidenceColor(c: string) {
  if (c === "HIGH") return "bg-neon-lime/15 text-neon-lime";
  if (c === "MEDIUM") return "bg-amber-400/15 text-amber-300";
  return "bg-tint/10 text-ink-muted";
}

interface ScoreFactorView {
  factor: string;
  points: number;
  maximumPoints: number;
  direction: string;
  explanation: string;
  provenance: string;
  evidence: { source: string; field: string; reference: string }[];
}

interface LeadScoreView {
  id: string;
  score: number;
  scoreBand: string;
  scoringVersion: string;
  factors: ScoreFactorView[];
  evidence: { source: string; field: string; reference: string }[];
  warnings: string[];
  aiEnriched: boolean;
  aiAssessment: {
    interpretation: string;
    keyStrengths: string[];
    keyGaps: string[];
    suggestedNextStep: string;
    provenance: string;
  } | null;
  confidence: string | null;
  createdAt: string;
  dataLabel?: string;
}

function bandColor(band: string) {
  if (band === "Very Strong Fit") return "bg-neon-lime/15 text-neon-lime";
  if (band === "Strong Fit") return "bg-neon-cyan/15 text-neon-cyan";
  if (band === "Moderate Fit") return "bg-amber-400/15 text-amber-300";
  return "bg-tint/10 text-ink-muted";
}

function provenanceBadgeFor(p: string) {
  const map: Record<string, string> = {
    VERIFIED_DATA: "bg-neon-lime/15 text-neon-lime",
    AI_INFERENCE: "bg-neon-violet/15 text-neon-violet",
    USER_PROVIDED: "bg-neon-blue/15 text-neon-blue",
    DEMO_DATA: "bg-neon-cyan/15 text-neon-cyan",
  };
  const label: Record<string, string> = {
    VERIFIED_DATA: "Verified data",
    AI_INFERENCE: "AI inference",
    USER_PROVIDED: "User provided",
    DEMO_DATA: "Demo data",
  };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${map[p] ?? "bg-tint/10 text-ink-muted"}`}
    >
      {label[p] ?? p}
    </span>
  );
}

function LeadScoreSection({ record }: { record: LeadScoreView }) {
  const isDemo = record.dataLabel === "DEMO_DATA";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-baseline gap-2">
          <span className="text-5xl font-semibold text-ink">{record.score}</span>
          <span className="text-sm text-ink-dim">/ 100</span>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${bandColor(record.scoreBand)}`}>
          {record.scoreBand}
        </span>
        {isDemo ? (
          <span className="rounded bg-neon-cyan/15 px-2 py-0.5 text-[11px] font-semibold text-neon-cyan">
            Demo data
          </span>
        ) : (
          <span className="rounded bg-tint/10 px-2 py-0.5 text-[11px] text-ink-muted">
            WDD Sales Opportunity Score · v{record.scoringVersion}
          </span>
        )}
        {record.aiEnriched && (
          <span className="rounded bg-neon-violet/15 px-2 py-0.5 text-[11px] font-semibold text-neon-violet">
            AI enriched
          </span>
        )}
        <span className="text-xs text-ink-dim">
          {new Date(record.createdAt).toLocaleString()}
        </span>
      </div>
      <p className="text-xs text-ink-dim">
        How strong is the available evidence of a relevant WDD sales opportunity —
        not a judgment of the business itself.
      </p>

      {record.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-200/90">
          {record.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {record.factors.map((f, i) => (
          <div key={i} className="rounded-xl border border-line bg-black/20 p-4">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-semibold text-ink">{f.factor}</h4>
              <span className="shrink-0 text-sm font-semibold text-neon-cyan">
                {f.points}
                <span className="font-normal text-ink-dim">/{f.maximumPoints}</span>
              </span>
            </div>
            <div className="mt-1.5">{provenanceBadgeFor(f.provenance)}</div>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">{f.explanation}</p>
            {f.evidence.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {f.evidence.map((e, j) => (
                  <span
                    key={j}
                    className="rounded bg-tint/5 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim"
                    title={`Evidence: ${e.reference}`}
                  >
                    {e.source}.{e.field}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {record.aiAssessment && (
        <div className="rounded-xl border border-neon-violet/20 bg-neon-violet/5 p-4">
          <h4 className="mb-2 text-sm font-semibold text-neon-violet">
            AI interpretation {provenanceBadgeFor("AI_INFERENCE")}
          </h4>
          <p className="text-sm text-ink">{record.aiAssessment.interpretation}</p>
          {record.aiAssessment.keyStrengths.length > 0 && (
            <div className="mt-2 text-xs text-ink-muted">
              <span className="font-semibold text-ink">Strengths: </span>
              {record.aiAssessment.keyStrengths.join(" · ")}
            </div>
          )}
          {record.aiAssessment.keyGaps.length > 0 && (
            <div className="mt-1 text-xs text-ink-muted">
              <span className="font-semibold text-ink">Gaps: </span>
              {record.aiAssessment.keyGaps.join(" · ")}
            </div>
          )}
          <div className="mt-2 text-xs text-ink-muted">
            <span className="font-semibold text-ink">Suggested next step: </span>
            {record.aiAssessment.suggestedNextStep}
          </div>
        </div>
      )}
    </div>
  );
}

function AIIntelligenceView({ record }: { record: AIIntelligenceRecord }) {
  const intel = record.intelligence as AIIntelligenceData;
  const isDemo = record.dataLabel === "DEMO_DATA";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {isDemo ? (
          <span className="rounded bg-neon-cyan/15 px-2 py-0.5 text-[11px] font-semibold text-neon-cyan">
            Demo data
          </span>
        ) : (
          <span className="rounded bg-neon-violet/15 px-2 py-0.5 text-[11px] font-semibold text-neon-violet">
            AI inference over verified data
          </span>
        )}
        <span className="text-xs text-ink-dim">
          Generated {new Date(record.generatedAt).toLocaleString()}
        </span>
        <span className="text-xs text-ink-dim">
          {record.provider}
          {record.model ? ` · ${record.model}` : ""}
        </span>
        {record.confidence && (
          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${confidenceColor(record.confidence)}`}>
            {record.confidence} confidence
          </span>
        )}
      </div>

      {record.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-200/90">
          {record.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      <Section title="Company summary">
        <p className="py-2 text-sm text-ink">{intel.summary.text}</p>
        <EvidenceChips refs={intel.summary.evidence} />
        <Row label="Business type">
          <span>{intel.businessType}</span>
        </Row>
      </Section>

      <Section title="Verified signals">
        <InferenceList items={intel.verifiedSignals} />
      </Section>

      <Section title="AI opportunities">
        <InferenceList items={intel.inferredOpportunities} />
      </Section>

      <Section title="Recommended WDD services">
        <InferenceList items={intel.recommendedServices} />
      </Section>

      <Section title="Suggested sales angle">
        <p className="py-2 text-sm text-ink">
          {typeBadge("AI_INFERENCE")}
          {intel.salesAngle.text}
        </p>
        <EvidenceChips refs={intel.salesAngle.evidence} />
      </Section>

      <Section title="Discovery questions">
        {intel.discoveryQuestions.length === 0 ? (
          <p className="py-2 text-sm text-ink-dim">No questions generated.</p>
        ) : (
          <ol className="list-decimal space-y-1 py-2 pl-5 text-sm text-ink">
            {intel.discoveryQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Confidence & evidence">
        <Row label="Confidence">
          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${confidenceColor(intel.confidence)}`}>
            {intel.confidence}
          </span>
        </Row>
        <Row label="Why">{intel.confidenceReason}</Row>
        <Row label="Evidence sources">
          <EvidenceChips refs={intel.evidence} />
        </Row>
      </Section>
    </div>
  );
}

export function WebsiteIntelligence({ apiBase, demo = false }: IntelligenceProps) {
  const searchParams = useSearchParams();
  const leadIdParam = searchParams.get("leadId");

  const [url, setUrl] = useState("");
  const [leadId, setLeadId] = useState<string | null>(leadIdParam);
  const [leadWebsite, setLeadWebsite] = useState<string | null>(null);
  const [leadName, setLeadName] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [history, setHistory] = useState<Inspection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [aiIntel, setAiIntel] = useState<AIIntelligenceRecord | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [leadScore, setLeadScore] = useState<LeadScoreView | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [scoreCalculating, setScoreCalculating] = useState(false);

  // When opened with ?leadId=, resolve the lead's website for context.
  useEffect(() => {
    if (!leadIdParam || demo) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${apiBase}/leads/${leadIdParam}`);
        if (!res.ok) return;
        const data = await res.json();
        const lead = data.lead ?? data;
        setLeadWebsite(lead.website ?? null);
        setLeadName(lead.fullName ?? lead.company?.name ?? null);
      } catch {
        /* context is optional */
      }
    }, 0);
    return () => clearTimeout(t);
  }, [leadIdParam, apiBase, demo]);

  useEffect(() => {
    if (demo) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${apiBase}/intelligence/website-inspections?limit=10`);
        if (!res.ok) return;
        const data = await res.json();
        setHistory(data.inspections ?? []);
      } catch {
        /* history is optional */
      }
    }, 0);
    return () => clearTimeout(t);
  }, [apiBase, demo]);

  // Load the latest AI intelligence for the lead, if any.
  useEffect(() => {
    if (!leadIdParam) return;
    const t = setTimeout(async () => {
      setAiLoading(true);
      try {
        const res = await fetch(
          `${apiBase}/intelligence/lead?leadId=${encodeURIComponent(leadIdParam)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.intelligence) setAiIntel(data.intelligence);
      } catch {
        /* AI intelligence is optional */
      } finally {
        setAiLoading(false);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [leadIdParam, apiBase]);

  // Load the latest lead score for the lead, if any.
  useEffect(() => {
    if (!leadIdParam) return;
    const t = setTimeout(async () => {
      setScoreLoading(true);
      try {
        const res = await fetch(
          `${apiBase}/intelligence/lead-score?leadId=${encodeURIComponent(leadIdParam)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.score) setLeadScore(data.score);
      } catch {
        /* lead score is optional */
      } finally {
        setScoreLoading(false);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [leadIdParam, apiBase]);

  async function runInspection(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setNotice(null);
    const payload: Record<string, string> = {};
    if (leadId) payload.leadId = leadId;
    else if (url.trim()) payload.url = url.trim();
    else {
      setError("Enter a website URL or choose a lead.");
      return;
    }
    setInspecting(true);
    try {
      const res = await fetch(`${apiBase}/intelligence/website-inspect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Inspection failed.");
      }
      const insp: Inspection = data.inspection;
      setInspection(insp);
      if (insp.status === "FAILED") {
        setNotice(
          `Inspection failed: ${insp.error ?? "unknown reason"}. No results were fabricated.`,
        );
      } else if (!demo) {
        // Refresh history in the background.
        fetch(`${apiBase}/intelligence/website-inspections?limit=10`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d) setHistory(d.inspections ?? []);
          })
          .catch(() => undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inspection failed.");
    } finally {
      setInspecting(false);
    }
  }

  async function generateAI() {
    if (!leadIdParam) return;
    setError(null);
    setNotice(null);
    setAiGenerating(true);
    try {
      const res = await fetch(`${apiBase}/intelligence/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: leadIdParam }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = data.error as string | undefined;
        if (code === "AI_NOT_CONFIGURED") {
          throw new Error("AI Intelligence is not configured.");
        }
        if (code === "INSUFFICIENT_DATA") {
          throw new Error(
            "Not enough data yet — run Website Inspection first, then generate AI intelligence.",
          );
        }
        throw new Error(data.message || data.error || "AI generation failed.");
      }
      const rec: AIIntelligenceRecord = data.intelligence;
      setAiIntel(rec);
      if (rec.status === "FAILED") {
        setNotice(`AI generation failed: ${rec.error ?? "unknown reason"}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI generation failed.");
    } finally {
      setAiGenerating(false);
    }
  }

  async function calculateLeadScore() {
    if (!leadIdParam) return;
    setError(null);
    setNotice(null);
    setScoreCalculating(true);
    try {
      const res = await fetch(`${apiBase}/intelligence/lead-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: leadIdParam }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.reason || data.error || "Score calculation failed.");
      }
      setLeadScore(data.score as LeadScoreView);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Score calculation failed.");
    } finally {
      setScoreCalculating(false);
    }
  }

  const findings =
    inspection && inspection.status === "COMPLETED"
      ? (inspection.findings as Findings)
      : null;

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss" className="text-red-300/70 hover:text-red-300">
            ✕
          </button>
        </div>
      )}
      {notice && (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="text-amber-200/70 hover:text-amber-200">
            ✕
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-tint/5 p-6">
        <h2 className="text-lg font-semibold">Inspect a website</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {demo
            ? "Demo mode — returns a fictional sample report. No real requests are made."
            : "Technical inspection of a publicly accessible page. Private/internal addresses are never fetched."}
        </p>

        {leadId && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-black/20 px-4 py-3">
            <span className="text-sm text-ink-muted">
              Inspecting website for lead{leadName ? ` “${leadName}”` : ""}{" "}
              {leadWebsite && <span className="text-ink-dim">({leadWebsite})</span>}
            </span>
            <button
              onClick={() => {
                setLeadId(null);
                setLeadWebsite(null);
                setLeadName(null);
              }}
              className="text-xs text-ink-muted underline hover:text-ink"
            >
              Inspect a different URL instead
            </button>
          </div>
        )}

        {!leadId && (
          <form onSubmit={runInspection} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              aria-label="Website URL"
              className={inputCls}
            />
            <button
              type="submit"
              disabled={inspecting}
              className="shrink-0 rounded-lg bg-neon-cyan px-6 py-2.5 text-sm font-semibold text-[#021614] transition hover:brightness-110 disabled:opacity-50"
            >
              {inspecting ? "Inspecting…" : "Inspect Website"}
            </button>
          </form>
        )}
        {leadId && (
          <button
            onClick={() => runInspection()}
            disabled={inspecting}
            className="mt-4 rounded-lg bg-neon-cyan px-6 py-2.5 text-sm font-semibold text-[#021614] transition hover:brightness-110 disabled:opacity-50"
          >
            {inspecting ? "Inspecting…" : "Inspect Website"}
          </button>
        )}
      </div>

      {inspection && inspection.status === "FAILED" && (
        <div className="rounded-2xl border border-line bg-tint/5 p-6">
          <h2 className="text-lg font-semibold">Inspection failed</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Requested URL: <span className="break-all text-ink">{inspection.requestedUrl}</span>
          </p>
          <p className="mt-1 text-sm text-amber-200">
            Reason: {inspection.error ?? "unknown"}
          </p>
          <p className="mt-2 text-xs text-ink-dim">
            Provenance: {provenanceBadge(inspection.dataLabel)} ·{" "}
            {new Date(inspection.inspectedAt).toLocaleString()}
          </p>
        </div>
      )}

      {findings && (
        <div className="rounded-2xl border border-line bg-tint/5 p-6">
          <h2 className="mb-4 text-lg font-semibold">Inspection report</h2>
          <FindingsView findings={findings} />
        </div>
      )}

      {leadIdParam && (
        <div className="rounded-2xl border border-line bg-tint/5 p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">AI Lead Score</h2>
            <button
              onClick={calculateLeadScore}
              disabled={scoreCalculating}
              className="rounded-lg bg-neon-cyan px-5 py-2 text-sm font-semibold text-[#021614] transition hover:brightness-110 disabled:opacity-50"
            >
              {scoreCalculating ? "Calculating…" : "Calculate Score"}
            </button>
          </div>
          {demo && (
            <p className="mb-3 text-xs text-ink-dim">
              Demo mode — deterministic fictional sample. No AI service is called.
            </p>
          )}
          {scoreLoading && <p className="text-sm text-ink-dim">Loading…</p>}
          {!scoreLoading && !leadScore && (
            <p className="text-sm text-ink-muted">
              No score calculated yet for this lead. Scores are evidence-based
              and explainable — run Website Inspection first for the richest signal.
            </p>
          )}
          {leadScore && <LeadScoreSection record={leadScore} />}
        </div>
      )}

      {leadIdParam && (
        <div className="rounded-2xl border border-line bg-tint/5 p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">AI lead intelligence</h2>
            <button
              onClick={generateAI}
              disabled={aiGenerating}
              className="rounded-lg bg-neon-cyan px-5 py-2 text-sm font-semibold text-[#021614] transition hover:brightness-110 disabled:opacity-50"
            >
              {aiGenerating ? "Generating…" : "Generate AI Intelligence"}
            </button>
          </div>
          {demo && (
            <p className="mb-3 text-xs text-ink-dim">
              Demo mode — fictional sample report. No AI service is called.
            </p>
          )}
          {aiLoading && <p className="text-sm text-ink-dim">Loading…</p>}
          {!aiLoading && !aiIntel && (
            <p className="text-sm text-ink-muted">
              No AI intelligence generated yet for this lead.{" "}
              {demo
                ? "Press the button to see a fictional sample."
                : "Generate one from the lead's verified data — run Website Inspection first for the best results."}
            </p>
          )}
          {aiIntel && aiIntel.status === "FAILED" && (
            <p className="text-sm text-amber-200">
              Last generation failed: {aiIntel.error ?? "unknown reason"}. No results were fabricated.
            </p>
          )}
          {aiIntel && aiIntel.status === "COMPLETED" && (
            <AIIntelligenceView record={aiIntel} />
          )}
        </div>
      )}

      {!demo && history.length > 0 && (
        <div className="rounded-2xl border border-line bg-tint/5 p-6">
          <h2 className="mb-3 text-lg font-semibold">Recent inspections</h2>
          <ul className="divide-y divide-line/60">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1 break-all text-ink-muted">
                  {h.requestedUrl}
                  {h.lead?.fullName && (
                    <span className="ml-2 text-xs text-ink-dim">· {h.lead.fullName}</span>
                  )}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-semibold ${
                    h.status === "COMPLETED"
                      ? "bg-neon-lime/15 text-neon-lime"
                      : "bg-red-400/15 text-red-300"
                  }`}
                >
                  {h.status}
                </span>
                <button
                  onClick={() => setInspection(h)}
                  className="text-xs text-neon-cyan hover:underline"
                >
                  View
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
