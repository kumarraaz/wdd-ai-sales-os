"use client";

import { useEffect, useState } from "react";

interface OutreachLead {
  id: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  googleMapsUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  linkedinUrl: string | null;
  company: { name: string } | null;
}

type Channel = "instagram" | "facebook" | "linkedin" | "whatsapp" | "email" | "call";

const CHANNEL_LABEL: Record<Channel, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  email: "Email",
  call: "Call",
};

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Manual outreach actions for a lead. NOTHING is sent automatically:
 * - Social buttons open the real profile URL in a new tab (only when the
 *   source provided one — URLs are never guessed).
 * - "Copy message" generates a personalized draft via the AI provider and
 *   copies it to the clipboard for manual paste + send.
 */
export function LeadOutreach({ leadId, apiBase }: { leadId: string; apiBase: string }) {
  const [lead, setLead] = useState<OutreachLead | null>(null);
  const [busy, setBusy] = useState<Channel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiBase}/leads/${leadId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.lead && setLead(d.lead))
      .catch(() => {});
  }, [apiBase, leadId]);

  async function copyMessage(channel: Channel) {
    setBusy(channel);
    setNotice(null);
    try {
      const res = await fetch(`${apiBase}/leads/${leadId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Generation failed");
      await navigator.clipboard.writeText(data.message);
      setNotice(
        channel === "instagram" || channel === "linkedin" || channel === "facebook"
          ? `${CHANNEL_LABEL[channel]} profile opened. Message copied. Paste and send manually.`
          : "Message copied to clipboard. Paste and send manually.",
      );
    } catch (err) {
      setNotice(`Could not generate message: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setBusy(null);
    }
  }

  async function openSocial(channel: "instagram" | "facebook" | "linkedin", url: string | null) {
    // Generate + copy the draft first, then open the real profile.
    await copyMessage(channel);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  if (!lead) return null;

  const btn =
    "rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";
  const btnGold =
    "rounded-lg bg-[#D4AF37] px-4 py-2.5 text-sm font-bold text-black hover:brightness-110 disabled:opacity-40";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <h3 className="text-lg font-semibold text-white">Outreach</h3>
      <p className="mt-1 text-xs text-white/50">
        Manual outreach only — nothing is sent automatically. Open the profile, copy the AI-drafted message, paste and send it yourself.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {lead.phone && (
          <a className={btn} href={`tel:${digitsOnly(lead.phone)}`}>
            📞 Call
          </a>
        )}
        {lead.phone && (
          <a
            className={btn}
            href={`https://wa.me/${digitsOnly(lead.phone)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            💬 WhatsApp
          </a>
        )}
        {lead.website && (
          <a className={btn} href={lead.website} target="_blank" rel="noopener noreferrer">
            🌐 Open website
          </a>
        )}
        <button
          type="button"
          className={btn}
          disabled={!lead.instagramUrl}
          title={lead.instagramUrl ? "Open Instagram profile + copy message" : "No Instagram URL from source"}
          onClick={() => openSocial("instagram", lead.instagramUrl)}
        >
          📸 Instagram{lead.instagramUrl ? "" : " (no URL)"}
        </button>
        <button
          type="button"
          className={btn}
          disabled={!lead.facebookUrl}
          title={lead.facebookUrl ? "Open Facebook profile + copy message" : "No Facebook URL from source"}
          onClick={() => openSocial("facebook", lead.facebookUrl)}
        >
          👍 Facebook{lead.facebookUrl ? "" : " (no URL)"}
        </button>
        <button
          type="button"
          className={btn}
          disabled={!lead.linkedinUrl}
          title={lead.linkedinUrl ? "Open LinkedIn profile + copy message" : "No LinkedIn URL from source"}
          onClick={() => openSocial("linkedin", lead.linkedinUrl)}
        >
          💼 LinkedIn{lead.linkedinUrl ? "" : " (no URL)"}
        </button>
        {lead.googleMapsUrl && (
          <a className={btn} href={lead.googleMapsUrl} target="_blank" rel="noopener noreferrer">
            📍 Google Maps
          </a>
        )}
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
          Copy a personalized message draft
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CHANNEL_LABEL) as Channel[]).map((ch) => (
            <button
              key={ch}
              type="button"
              disabled={busy !== null}
              onClick={() => copyMessage(ch)}
              className={btnGold}
            >
              {busy === ch ? "Generating…" : `Copy ${CHANNEL_LABEL[ch]} message`}
            </button>
          ))}
        </div>
      </div>

      {notice && <p className="mt-3 text-sm text-emerald-300">{notice}</p>}
    </div>
  );
}
