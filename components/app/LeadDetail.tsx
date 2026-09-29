"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface LeadDetailData {
  id: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  industry: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  status: string;
  sourceType: string;
  sourceDetail: string | null;
  sourceUrl: string | null;
  externalId: string | null;
  discoveredAt: string | null;
  rating: number | null;
  reviewCount: number | null;
  dataLabel: string;
  company: { id: string; name: string } | null;
  scores: { id: string; score: number; scoreBand: string; createdAt: string }[];
  provenance: { field: string; value: string; source: string; label: string }[];
}

interface IntelStatus {
  websiteInspection: "completed" | "failed" | "none";
  aiIntelligence: "completed" | "failed" | "none";
}

const inputLabel = "text-xs font-medium uppercase tracking-wide text-white/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={inputLabel}>{label}</div>
      <div className="mt-0.5 text-sm text-white/85">{children}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const done = status === "completed";
  const failed = status === "failed";
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-semibold ${
        done
          ? "bg-emerald-400/15 text-emerald-300"
          : failed
            ? "bg-red-400/15 text-red-300"
            : "bg-white/10 text-white/50"
      }`}
    >
      {done ? "Available" : failed ? "Failed" : "Not run"}
    </span>
  );
}

export function LeadDetail({
  leadId,
  apiBase,
  demo = false,
}: {
  leadId: string;
  apiBase: string;
  demo?: boolean;
}) {
  const [lead, setLead] = useState<LeadDetailData | null>(null);
  const [intel, setIntel] = useState<IntelStatus>({
    websiteInspection: "none",
    aiIntelligence: "none",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${apiBase}/leads/${leadId}`);
        if (!res.ok) throw new Error("Lead not found.");
        const data = await res.json();
        setLead(data.lead ?? data);

        // Intelligence linkage — read-only status checks.
        const [wi, ai] = await Promise.all([
          fetch(`${apiBase}/intelligence/website-inspections?leadId=${leadId}&limit=1`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          fetch(`${apiBase}/intelligence/lead?leadId=${leadId}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ]);
        setIntel({
          websiteInspection: wi?.inspections?.[0]
            ? wi.inspections[0].status === "COMPLETED"
              ? "completed"
              : "failed"
            : "none",
          aiIntelligence: ai?.intelligence
            ? ai.intelligence.status === "COMPLETED"
              ? "completed"
              : "failed"
            : "none",
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load lead.");
      } finally {
        setLoading(false);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [leadId, apiBase]);

  if (loading) return <p className="text-sm text-white/50">Loading…</p>;
  if (error || !lead) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-red-300">{error ?? "Lead not found."}</p>
        <Link href="/leads" className="text-sm text-[#D4AF37] hover:underline">
          ← Back to leads
        </Link>
      </div>
    );
  }

  const latestScore = lead.scores?.[0] ?? null;
  const intelUrl = `/intelligence?leadId=${lead.id}`;

  return (
    <div className="space-y-6">
      <Link href="/leads" className="text-sm text-white/50 hover:text-white">
        ← Back to leads
      </Link>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">
              {lead.company?.name ?? lead.fullName ?? "Untitled lead"}
            </h2>
            {lead.company?.name && lead.fullName && (
              <p className="text-sm text-white/50">{lead.fullName}</p>
            )}
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80">
            {lead.status}
          </span>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Email">{lead.email ?? "—"}</Field>
          <Field label="Phone">{lead.phone ?? "—"}</Field>
          <Field label="Website">
            {lead.website ? (
              <span className="break-all">{lead.website}</span>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Industry">{lead.industry ?? "—"}</Field>
          <Field label="Location">
            {[lead.city, lead.country].filter(Boolean).join(", ") || "—"}
          </Field>
          <Field label="Job title">{lead.jobTitle ?? "—"}</Field>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h3 className="mb-4 text-lg font-semibold">Source & provenance</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Source">{lead.sourceType}</Field>
          <Field label="Source detail">{lead.sourceDetail ?? "—"}</Field>
          <Field label="Data label">
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                lead.dataLabel === "DEMO_DATA"
                  ? "bg-[#D4AF37]/15 text-[#D4AF37]"
                  : lead.dataLabel === "AI_INFERENCE"
                    ? "bg-purple-400/15 text-purple-300"
                    : "bg-emerald-400/15 text-emerald-300"
              }`}
            >
              {lead.dataLabel === "VERIFIED" ? "Verified data" : lead.dataLabel.replace(/_/g, " ")}
            </span>
          </Field>
          <Field label="Source URL">
            {lead.sourceUrl ? (
              <span className="break-all text-xs">{lead.sourceUrl}</span>
            ) : (
              "—"
            )}
          </Field>
          <Field label="External ID">{lead.externalId ?? "—"}</Field>
          <Field label="Discovered">
            {lead.discoveredAt ? new Date(lead.discoveredAt).toLocaleString() : "—"}
          </Field>
          {(lead.rating != null || lead.reviewCount != null) && (
            <Field label="Provider rating">
              {lead.rating != null ? `${lead.rating}★` : "—"}
              {lead.reviewCount != null ? ` (${lead.reviewCount} reviews)` : ""}
            </Field>
          )}
        </div>
        {lead.provenance?.length > 0 && (
          <div className="mt-4">
            <div className={inputLabel}>Field provenance</div>
            <ul className="mt-1 space-y-1">
              {lead.provenance.slice(0, 10).map((p, i) => (
                <li key={i} className="text-xs text-white/55">
                  <span className="font-mono text-white/75">{p.field}</span> ← {p.source}{" "}
                  <span className="text-white/35">({p.label})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h3 className="mb-4 text-lg font-semibold">Intelligence</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white/80">Website report</span>
              <StatusPill status={intel.websiteInspection} />
            </div>
            <Link
              href={intelUrl}
              className="mt-3 inline-block text-xs text-[#D4AF37] hover:underline"
            >
              View Website Report →
            </Link>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white/80">AI intelligence</span>
              <StatusPill status={intel.aiIntelligence} />
            </div>
            <Link
              href={intelUrl}
              className="mt-3 inline-block text-xs text-[#D4AF37] hover:underline"
            >
              View Intelligence →
            </Link>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white/80">Opportunity score</span>
              {latestScore ? (
                <span className="text-lg font-bold text-[#D4AF37]">{latestScore.score}</span>
              ) : (
                <span className="text-xs text-white/40">Not scored</span>
              )}
            </div>
            {latestScore && (
              <div className="mt-1 text-xs text-white/50">{latestScore.scoreBand}</div>
            )}
            <Link
              href={intelUrl}
              className="mt-3 inline-block text-xs text-[#D4AF37] hover:underline"
            >
              View Score →
            </Link>
          </div>
        </div>
        {!demo && intel.websiteInspection === "none" && (
          <p className="mt-3 text-xs text-white/40">
            Tip: run Website Inspection from the Intelligence page to unlock the
            richest signals for this lead.
          </p>
        )}
      </div>
    </div>
  );
}
