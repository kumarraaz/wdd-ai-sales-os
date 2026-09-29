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
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#D4AF37]";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start">
      <dt className="w-44 shrink-0 text-xs font-medium uppercase tracking-wide text-white/40">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm text-white/85">{children}</dd>
    </div>
  );
}

function YesNo({ value, yes = "Yes", no = "No" }: { value: boolean; yes?: string; no?: string }) {
  return (
    <span className={value ? "text-emerald-300" : "text-white/40"}>
      {value ? yes : no}
    </span>
  );
}

function Missing({ text = "Not found in inspected page" }: { text?: string }) {
  return <span className="text-white/35">— <span className="text-xs">{text}</span></span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <h3 className="mb-1 text-sm font-semibold text-[#D4AF37]">{title}</h3>
      <dl className="divide-y divide-white/5">{children}</dl>
    </div>
  );
}

function provenanceBadge(provenance: string) {
  const isDemo = provenance === "DEMO_DATA";
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold ${
        isDemo ? "bg-[#D4AF37]/15 text-[#D4AF37]" : "bg-emerald-400/15 text-emerald-300"
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
        <span className="text-xs text-white/40">
          Inspected {new Date(f.inspectedAt).toLocaleString()}
        </span>
        <span className="break-all text-xs text-white/40">{f.finalUrl}</span>
      </div>

      <Section title="Website status">
        <Row label="HTTP status">
          <span className={f.httpStatus >= 200 && f.httpStatus < 300 ? "text-emerald-300" : "text-amber-300"}>
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
                  <span className="text-white/50">{h.status} → </span>
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
          <span className="text-xs text-white/35">{f.robotsTxt.url}</span>
        </Row>
        <Row label="sitemap.xml">
          <YesNo value={f.sitemap.available} yes="Found" no="Not found" />{" "}
          <span className="text-xs text-white/35">{f.sitemap.url}</span>
        </Row>
        <Row label="Favicon">
          <YesNo value={f.favicon.available} yes="Found" no="Not found" />
          {f.favicon.href && (
            <span className="ml-2 text-xs text-white/35">{f.favicon.href}</span>
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
                <span className="text-emerald-300"> · width=device-width detected</span>
              )}
            </span>
          ) : (
            <Missing text="No viewport meta tag" />
          )}
        </Row>
      </Section>

      <Section title="Technology signals">
        {f.techSignals.length === 0 ? (
          <p className="py-2 text-sm text-white/35">
            No reliable CMS/framework patterns detected in the inspected HTML.
          </p>
        ) : (
          <ul className="space-y-2 py-1">
            {f.techSignals.map((t, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium text-white/85">{t.signal}</span>{" "}
                <span className="rounded bg-purple-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-purple-300">
                  AI inference
                </span>
                <div className="text-xs text-white/40">{t.evidence}</div>
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
                  <span className="text-white/50">{s.platform}: </span>
                  <span className="break-all text-sky-300">{s.url}</span>
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

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-lg font-semibold">Inspect a website</h2>
        <p className="mt-1 text-sm text-white/50">
          {demo
            ? "Demo mode — returns a fictional sample report. No real requests are made."
            : "Technical inspection of a publicly accessible page. Private/internal addresses are never fetched."}
        </p>

        {leadId && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-4 py-3">
            <span className="text-sm text-white/70">
              Inspecting website for lead{leadName ? ` “${leadName}”` : ""}{" "}
              {leadWebsite && <span className="text-white/40">({leadWebsite})</span>}
            </span>
            <button
              onClick={() => {
                setLeadId(null);
                setLeadWebsite(null);
                setLeadName(null);
              }}
              className="text-xs text-white/50 underline hover:text-white"
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
              className="shrink-0 rounded-lg bg-[#D4AF37] px-6 py-2.5 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {inspecting ? "Inspecting…" : "Inspect Website"}
            </button>
          </form>
        )}
        {leadId && (
          <button
            onClick={() => runInspection()}
            disabled={inspecting}
            className="mt-4 rounded-lg bg-[#D4AF37] px-6 py-2.5 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {inspecting ? "Inspecting…" : "Inspect Website"}
          </button>
        )}
      </div>

      {inspection && inspection.status === "FAILED" && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold">Inspection failed</h2>
          <p className="mt-2 text-sm text-white/60">
            Requested URL: <span className="break-all text-white/85">{inspection.requestedUrl}</span>
          </p>
          <p className="mt-1 text-sm text-amber-200">
            Reason: {inspection.error ?? "unknown"}
          </p>
          <p className="mt-2 text-xs text-white/40">
            Provenance: {provenanceBadge(inspection.dataLabel)} ·{" "}
            {new Date(inspection.inspectedAt).toLocaleString()}
          </p>
        </div>
      )}

      {findings && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="mb-4 text-lg font-semibold">Inspection report</h2>
          <FindingsView findings={findings} />
        </div>
      )}

      {!demo && history.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="mb-3 text-lg font-semibold">Recent inspections</h2>
          <ul className="divide-y divide-white/5">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1 break-all text-white/75">
                  {h.requestedUrl}
                  {h.lead?.fullName && (
                    <span className="ml-2 text-xs text-white/40">· {h.lead.fullName}</span>
                  )}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-semibold ${
                    h.status === "COMPLETED"
                      ? "bg-emerald-400/15 text-emerald-300"
                      : "bg-red-400/15 text-red-300"
                  }`}
                >
                  {h.status}
                </span>
                <button
                  onClick={() => setInspection(h)}
                  className="text-xs text-[#D4AF37] hover:underline"
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
