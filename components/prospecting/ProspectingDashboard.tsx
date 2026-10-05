"use client";

/**
 * Instagram Prospecting dashboard — 7-day weekly plan editor, manual
 * "Run Now", and daily run history. All writes go through tenant-isolated,
 * RBAC-checked API routes; the 9:00 AM run itself is driven by the existing
 * automation scheduler (no new scheduler).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Play, Save, Loader2, CalendarDays, History } from "lucide-react";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Display order: Monday first. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

interface PlanDay {
  dayOfWeek: number;
  industry: string;
  location?: string | null;
  country?: string | null;
  businessType?: string | null;
  targetAudience?: string | null;
  websitePreference?: string;
  followerThreshold?: number | null;
  targetCount?: number;
  isActive?: boolean;
}

interface Plan {
  id: string;
  name: string;
  isActive: boolean;
  timezone: string;
  runAtTime: string;
  days: PlanDay[];
}

interface Run {
  id: string;
  dayOfWeek: number;
  runDate: string;
  targetCount: number;
  found: number;
  newCount: number;
  duplicatesSkipped: number;
  researched: number;
  messagesGenerated: number;
  crmImported: number;
  failed: number;
  status: string;
  triggeredBy: string;
  startedAt: string;
}

function emptyDay(dow: number): PlanDay {
  return {
    dayOfWeek: dow,
    industry: "",
    location: "",
    country: "",
    businessType: "",
    targetAudience: "",
    websitePreference: "ANY",
    followerThreshold: null,
    targetCount: 75,
    isActive: true,
  };
}

export function ProspectingDashboard({
  orgId,
  canManage,
  canRun,
}: {
  orgId: string;
  /** SALES_MANAGER+ — may edit the plan. */
  canManage: boolean;
  /** SALES_EXECUTIVE+ — may trigger a manual run. */
  canRun: boolean;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Local editable copy of the 7 days.
  const [days, setDays] = useState<PlanDay[]>(DISPLAY_ORDER.map(emptyDay));
  const [name, setName] = useState("Weekly Instagram Prospecting");
  const [isActive, setIsActive] = useState(true);
  const [runAtTime, setRunAtTime] = useState("09:00");
  const [timezone, setTimezone] = useState("Asia/Kolkata");

  const headers = useMemo(() => ({ "x-org-id": orgId }), [orgId]);

  const loadRuns = useCallback(async () => {
    const rRes = await fetch("/api/prospecting/runs?take=30", { headers });
    if (rRes.ok) {
      const data = await rRes.json();
      setRuns(data.runs ?? []);
    }
  }, [headers]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pRes = await fetch("/api/prospecting/plan", { headers });
      if (pRes.ok) {
        const data = await pRes.json();
        if (data.plan) {
          setPlan(data.plan);
          setName(data.plan.name);
          setIsActive(data.plan.isActive);
          setRunAtTime(data.plan.runAtTime);
          setTimezone(data.plan.timezone);
          const byDow = new Map<number, PlanDay>(
            (data.plan.days ?? []).map((d: PlanDay) => [d.dayOfWeek, d]),
          );
          setDays(DISPLAY_ORDER.map((dow) => byDow.get(dow) ?? emptyDay(dow)));
        }
      }
      await loadRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [headers, loadRuns]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  // Live-refresh run history while a run is queued or in progress.
  useEffect(() => {
    if (!runs.some((r) => r.status === "QUEUED" || r.status === "RUNNING")) return;
    const t = setInterval(() => {
      void loadRuns();
    }, 10000);
    return () => clearInterval(t);
  }, [runs, loadRuns]);

  function updateDay(dow: number, patch: Partial<PlanDay>) {
    setDays((prev) => prev.map((d) => (d.dayOfWeek === dow ? { ...d, ...patch } : d)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        name,
        isActive,
        timezone,
        runAtTime,
        days: days
          .filter((d) => d.industry.trim())
          .map((d) => ({
            dayOfWeek: d.dayOfWeek,
            industry: d.industry.trim(),
            location: d.location?.trim() || undefined,
            country: d.country?.trim() || undefined,
            businessType: d.businessType?.trim() || undefined,
            targetAudience: d.targetAudience?.trim() || undefined,
            websitePreference: d.websitePreference ?? "ANY",
            followerThreshold: d.followerThreshold ?? undefined,
            targetCount: d.targetCount ?? 75,
            isActive: d.isActive ?? true,
          })),
      };
      const res = await fetch("/api/prospecting/plan", {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Save failed.");
      }
      setNotice("Plan saved — the daily 9:00 AM run is scheduled.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/prospecting/run-now", {
        method: "POST",
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        throw new Error(
          "A run is already queued or in progress for today — see the run history below.",
        );
      }
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Run failed to start.");
      if (data.alreadyRan) {
        setNotice("Today's run already completed — see history below.");
      } else {
        setNotice("Run started — watch the run history below for live progress.");
        // Show the run immediately; the 10s poller keeps it fresh.
        if (data.run) {
          setRuns((prev) => [data.run, ...prev.filter((r) => r.id !== data.run.id)]);
        }
      }
      await loadRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed.");
    } finally {
      setRunning(false);
    }
  }

  /** Latest run per weekday, for the weekly plan status column. */
  const latestByDow = useMemo(() => {
    const map = new Map<number, Run>();
    for (const r of runs) {
      if (!map.has(r.dayOfWeek)) map.set(r.dayOfWeek, r);
    }
    return map;
  }, [runs]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-white/50">
        <Loader2 size={16} className="animate-spin" /> Loading prospecting plan…
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-3 py-2 text-sm text-[#D4AF37]">
          {notice}
        </p>
      )}

      {/* Plan settings + actions */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-white/50">Plan name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canManage}
            className="mt-1 block w-64 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#D4AF37] disabled:opacity-50"
          />
        </div>
        <div>
          <label className="text-xs text-white/50">Daily run time</label>
          <input
            type="time"
            value={runAtTime}
            onChange={(e) => setRunAtTime(e.target.value)}
            disabled={!canManage}
            className="mt-1 block rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#D4AF37] disabled:opacity-50"
          />
        </div>
        <div>
          <label className="text-xs text-white/50">Timezone</label>
          <input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={!canManage}
            className="mt-1 block w-40 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#D4AF37] disabled:opacity-50"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            disabled={!canManage}
            className="h-4 w-4 accent-[#D4AF37]"
          />
          Active
        </label>
        <div className="ml-auto flex gap-2">
          {canRun && (
            <button
              onClick={runNow}
              disabled={running}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D4AF37]/40 px-4 py-2 text-sm text-[#D4AF37] hover:bg-[#D4AF37]/10 disabled:opacity-50"
            >
              {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              Run Now
            </button>
          )}
          {canManage && (
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save plan
            </button>
          )}
        </div>
      </div>

      {/* Weekly plan */}
      <div>
        <h2 className="mb-3 inline-flex items-center gap-2 text-lg font-semibold text-white">
          <CalendarDays size={18} className="text-[#D4AF37]" /> Weekly plan
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {days.map((d) => {
            const run = latestByDow.get(d.dayOfWeek);
            return (
              <div
                key={d.dayOfWeek}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              >
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold text-white">{DAY_LABELS[d.dayOfWeek]}</h3>
                  {run ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        run.status === "COMPLETED"
                          ? "bg-emerald-400/15 text-emerald-300"
                          : run.status === "FAILED"
                            ? "bg-red-400/15 text-red-300"
                            : "bg-amber-400/15 text-amber-300"
                      }`}
                    >
                      {run.status === "COMPLETED"
                        ? `Done · ${run.crmImported} imported`
                        : runStatusLabel(run.status)}
                    </span>
                  ) : (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/50">
                      Pending
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  <Field label="Industry / target">
                    <input
                      value={d.industry}
                      onChange={(e) => updateDay(d.dayOfWeek, { industry: e.target.value })}
                      disabled={!canManage}
                      placeholder="e.g. jewellery manufacturers"
                      className={inputCls}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Location">
                      <input
                        value={d.location ?? ""}
                        onChange={(e) => updateDay(d.dayOfWeek, { location: e.target.value })}
                        disabled={!canManage}
                        placeholder="Mumbai"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Country">
                      <input
                        value={d.country ?? ""}
                        onChange={(e) => updateDay(d.dayOfWeek, { country: e.target.value })}
                        disabled={!canManage}
                        placeholder="India"
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Business type">
                      <input
                        value={d.businessType ?? ""}
                        onChange={(e) => updateDay(d.dayOfWeek, { businessType: e.target.value })}
                        disabled={!canManage}
                        placeholder="manufacturer"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Target / day">
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={d.targetCount ?? 75}
                        onChange={(e) =>
                          updateDay(d.dayOfWeek, { targetCount: Number(e.target.value) || 75 })
                        }
                        disabled={!canManage}
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Website">
                      <select
                        value={d.websitePreference ?? "ANY"}
                        onChange={(e) => updateDay(d.dayOfWeek, { websitePreference: e.target.value })}
                        disabled={!canManage}
                        className={inputCls}
                      >
                        <option value="ANY">Any</option>
                        <option value="NO_WEBSITE">No website</option>
                        <option value="HAS_WEBSITE">Has website</option>
                      </select>
                    </Field>
                    <Field label="Followers ≥ (if known)">
                      <input
                        type="number"
                        min={0}
                        value={d.followerThreshold ?? ""}
                        onChange={(e) =>
                          updateDay(d.dayOfWeek, {
                            followerThreshold: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        disabled={!canManage}
                        placeholder="—"
                        title="Stored for reference; not enforceable from compliant sources"
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-white/60">
                    <input
                      type="checkbox"
                      checked={d.isActive ?? true}
                      onChange={(e) => updateDay(d.dayOfWeek, { isActive: e.target.checked })}
                      disabled={!canManage}
                      className="h-3.5 w-3.5 accent-[#D4AF37]"
                    />
                    Active this week
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-white/40">
          Leave a day&apos;s industry blank to skip it. Follower threshold is stored but cannot be
          enforced — follower counts aren&apos;t available from compliant sources.
        </p>
      </div>

      {/* Run history */}
      <div>
        <h2 className="mb-3 inline-flex items-center gap-2 text-lg font-semibold text-white">
          <History size={18} className="text-[#D4AF37]" /> Run history
        </h2>
        {runs.length === 0 ? (
          <p className="text-sm text-white/40">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  {["Date", "Day", "Target", "Found", "New", "Duplicates", "Messages", "Imported", "Failed", "Status", "By"].map(
                    (h) => (
                      <th key={h} className="px-4 py-3 font-medium text-white/60">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-white/5">
                    <td className="px-4 py-2.5 text-white/80">{r.runDate}</td>
                    <td className="px-4 py-2.5 text-white/60">{DAY_LABELS[r.dayOfWeek]}</td>
                    <td className="px-4 py-2.5 text-white/80">{r.targetCount}</td>
                    <td className="px-4 py-2.5 text-white/80">{r.found}</td>
                    <td className="px-4 py-2.5 text-white/80">{r.newCount}</td>
                    <td className="px-4 py-2.5 text-white/60">{r.duplicatesSkipped}</td>
                    <td className="px-4 py-2.5 text-white/80">{r.messagesGenerated}</td>
                    <td className="px-4 py-2.5 font-semibold text-emerald-300">{r.crmImported}</td>
                    <td className="px-4 py-2.5 text-white/60">{r.failed}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          r.status === "COMPLETED"
                            ? "bg-emerald-400/15 text-emerald-300"
                            : r.status === "FAILED"
                              ? "bg-red-400/15 text-red-300"
                              : "bg-amber-400/15 text-amber-300"
                        }`}
                      >
                        {runStatusLabel(r.status)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-white/40">{r.triggeredBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** Human-friendly run status for badges. */
function runStatusLabel(status: string): string {
  if (status === "QUEUED") return "Queued";
  if (status === "RUNNING") return "Running";
  return status;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-white/50">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#D4AF37] disabled:opacity-50";
