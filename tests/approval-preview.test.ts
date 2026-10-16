import { describe, expect, it } from "vitest";
import { previewApproval } from "@/lib/approval-preview";

describe("previewApproval", () => {
  it("shows the draft exactly as stored", () => {
    const p = previewApproval(
      "OUTREACH_DRAFT",
      { leadId: "clx9abcdefghij", channel: "EMAIL", subject: "Hello", body: "Line 1\nLine 2" },
      { label: "Acme Co", channel: "EMAIL", leadId: "clx9abcdefghij" },
    );
    expect(p.heading).toBe("Outreach draft");
    expect(p.noun).toBe("outreach draft");
    expect(previewApproval("CRM_TASK", {}, {}).noun).toBe("CRM task"); // acronyms keep their case in sentences
    expect(p.recipient).toBe("Acme Co");
    expect(p.channel).toBe("EMAIL");
    expect(p.leadHref).toBe("/leads/clx9abcdefghij");
    expect(p.fields).toEqual([
      { label: "Channel", value: "EMAIL", long: undefined },
      { label: "Subject", value: "Hello", long: undefined },
      { label: "Message", value: "Line 1\nLine 2", long: true },
    ]);
    expect(p.hasHiddenFields).toBe(false);
  });

  it("never claims a message is sent", () => {
    for (const t of ["OUTREACH_DRAFT", "CRM_FOLLOWUP", "CRM_TASK"]) {
      expect(previewApproval(t, {}, {}).effect.toLowerCase()).not.toMatch(/\bwill be sent\b|\bsends?\b(?! )/);
    }
    expect(previewApproval("OUTREACH_DRAFT", {}, {}).effect).toMatch(/not sent/i);
  });

  it("formats follow-up and task dates in UTC", () => {
    const f = previewApproval("CRM_FOLLOWUP", { channel: "WHATSAPP", scheduledAt: "2026-11-02T09:30:00.000Z" }, {});
    expect(f.fields.find((x) => x.label === "Scheduled for")?.value).toBe("2026-11-02 09:30 UTC");
    const t = previewApproval("CRM_TASK", { title: "Call back", priority: "HIGH", dueAt: "2026-11-02T00:00:00Z" }, {});
    expect(t.fields.map((x) => x.label)).toEqual(["Title", "Priority", "Due"]);
  });

  it("truncates very long bodies and ignores invalid values", () => {
    const p = previewApproval("OUTREACH_DRAFT", { body: "x".repeat(9000), subject: 42, channel: null }, {});
    const body = p.fields.find((f) => f.label === "Message")!;
    expect(body.value.length).toBeLessThanOrEqual(4001);
    expect(body.value.endsWith("…")).toBe(true);
    expect(p.fields.some((f) => f.label === "Subject")).toBe(false);
    expect(previewApproval("CRM_TASK", { dueAt: "not a date" }, {}).fields).toEqual([]);
  });

  it("flags — but does not print — fields it does not know", () => {
    const p = previewApproval("OUTREACH_DRAFT", { body: "hi", secretToken: "abc", nested: { a: 1 } }, {});
    expect(p.hasHiddenFields).toBe(true);
    expect(JSON.stringify(p)).not.toContain("abc");
  });

  it("only links to plain lead ids", () => {
    expect(previewApproval("OUTREACH_DRAFT", {}, { leadId: "../../admin" }).leadHref).toBeNull();
    expect(previewApproval("OUTREACH_DRAFT", {}, { leadId: "javascript:alert(1)" }).leadHref).toBeNull();
    expect(previewApproval("OUTREACH_DRAFT", {}, {}).leadHref).toBeNull();
  });

  it("copes with garbage snapshots", () => {
    for (const bad of [null, undefined, 5, "x", [], [1, 2]]) {
      expect(() => previewApproval("CRM_TASK", bad, bad)).not.toThrow();
    }
    expect(previewApproval("SOMETHING_NEW", {}, {}).heading).toBe("Outreach draft");
  });
});
