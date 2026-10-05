/**
 * Industry classification — deterministic signal + AI reasoning.
 *
 * The deterministic keyword matcher (industryMatchesTarget) stays as one
 * signal, but for serious candidates the AI classifier reads ALL the
 * verified evidence and returns a source-backed classification:
 *
 *   { industry, subIndustry, relevanceScore (0–100), reasoning }
 *
 * Rules:
 * - reasoning MUST cite sources; never classify from a bare username.
 * - when the AI provider is not configured, the deterministic matcher is
 *   used and the result is labeled accordingly (honest, not hidden).
 * - the classifier never invents businesses — it only scores the evidence
 *   it was given.
 */
import { getAIProvider } from "../ai/registry";
import { industryMatchesTarget } from "../discovery/candidates";

export interface IndustryEvidence {
  businessName: string | null;
  category: string | null;
  location: string | null;
  website: string | null;
  observations: string | null;
  /** Short source labels, e.g. ["Google Places", "Tavily web search"]. */
  sourceLabels: string[];
}

export interface IndustryClassification {
  industry: string;
  subIndustry: string | null;
  /** 0–100 relevance of the candidate to the TARGET industry. */
  relevanceScore: number;
  /** Source-backed reasoning. */
  reasoning: string;
  /** "ai" when the model classified, "deterministic" for the fallback. */
  classifiedBy: "ai" | "deterministic";
}

const CLASSIFY_SYSTEM = `You classify a business candidate against a target industry for B2B prospecting.
STRICT RULES:
- Score relevance 0-100: how well the candidate fits the TARGET industry (not how interesting the business is).
- Your reasoning MUST cite the evidence sources provided. Never invent facts.
- Never classify from a bare social-media username alone — require business evidence (name, category, description, website).
- If evidence is thin or contradictory, say so and score low.
- Return ONLY valid JSON: {"industry": string, "subIndustry": string|null, "relevanceScore": number, "reasoning": string}.`;

function deterministicClassify(
  evidence: IndustryEvidence,
  targetIndustry: string,
): IndustryClassification {
  const haystack = `${evidence.category ?? ""} ${evidence.businessName ?? ""} ${evidence.observations ?? ""}`;
  const match = industryMatchesTarget(haystack, "", targetIndustry);
  return {
    industry: match ? targetIndustry : (evidence.category ?? "Unknown"),
    subIndustry: null,
    relevanceScore: match ? 85 : 20,
    reasoning: match
      ? `Deterministic keyword match against target "${targetIndustry}" (AI classifier not configured).`
      : `No keyword evidence for target "${targetIndustry}" in the available business data (AI classifier not configured).`,
    classifiedBy: "deterministic",
  };
}

export async function classifyIndustry(
  evidence: IndustryEvidence,
  targetIndustry: string,
  opts: { skipAi?: boolean } = {},
): Promise<IndustryClassification> {
  // AI classification is budgeted per run (pipeline passes skipAi once the
  // budget is spent); without a configured provider the deterministic
  // matcher is used and labeled honestly.
  let provider = null;
  try {
    provider = opts.skipAi ? null : getAIProvider();
  } catch {
    provider = null;
  }
  if (!provider || !provider.isConfigured()) {
    return deterministicClassify(evidence, targetIndustry);
  }

  const user =
    `Target industry: ${targetIndustry}\n\n` +
    `Candidate evidence (do not invent beyond this):\n` +
    `- Business name: ${evidence.businessName ?? "unknown"}\n` +
    `- Category: ${evidence.category ?? "unknown"}\n` +
    `- Location: ${evidence.location ?? "unknown"}\n` +
    `- Website: ${evidence.website ?? "unknown"}\n` +
    `- Observations: ${evidence.observations ?? "none"}\n` +
    `- Evidence sources: ${evidence.sourceLabels.join(", ") || "none"}\n\n` +
    `Classify the candidate against the target industry as JSON.`;

  try {
    const gen = await provider.generateJson(CLASSIFY_SYSTEM, user, { maxTokens: 400 });
    const parsed = JSON.parse(gen.text) as {
      industry?: unknown;
      subIndustry?: unknown;
      relevanceScore?: unknown;
      reasoning?: unknown;
    };
    const relevanceScore =
      typeof parsed.relevanceScore === "number"
        ? Math.min(100, Math.max(0, Math.round(parsed.relevanceScore)))
        : 0;
    const reasoning =
      typeof parsed.reasoning === "string" && parsed.reasoning.trim()
        ? parsed.reasoning.trim().slice(0, 500)
        : "No reasoning provided by the classifier.";
    return {
      industry:
        typeof parsed.industry === "string" && parsed.industry.trim()
          ? parsed.industry.trim().slice(0, 120)
          : "Unknown",
      subIndustry:
        typeof parsed.subIndustry === "string" && parsed.subIndustry.trim()
          ? parsed.subIndustry.trim().slice(0, 120)
          : null,
      relevanceScore,
      reasoning,
      classifiedBy: "ai",
    };
  } catch {
    // AI failure must never block or invent — fall back to deterministic.
    return deterministicClassify(evidence, targetIndustry);
  }
}
