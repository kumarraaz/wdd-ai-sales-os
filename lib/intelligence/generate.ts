/**
 * AI lead-intelligence generation orchestration (Phase 2 Step 3).
 *
 * Pipeline: constrained input → prompt → Gemini → JSON parse → Zod
 * validation (one retry) → evidence-reference guard → structured result.
 * Never saves malformed output as valid intelligence.
 */
import {
  generateJson,
  AIProviderError,
  isAIConfigured,
  getAIModelName,
  type AIGenerateOptions,
} from "./ai-provider";
import {
  leadIntelligenceOutputSchema,
  type EvidenceRef,
  type LeadIntelligenceOutput,
} from "./intelligence-schema";
import {
  buildConstrainedInput,
  buildPrompt,
  getAllowedEvidenceRefs,
  PROMPT_VERSION,
  type AIInputLead,
  type AIInputCompany,
  type AIInputInspection,
  type ConstrainedAIInput,
} from "./prompt";

export type IntelligenceErrorCode =
  | "INSUFFICIENT_DATA"
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "INVALID_RESPONSE"
  | "SCHEMA_ERROR";

export class IntelligenceError extends Error {
  code: IntelligenceErrorCode;
  constructor(code: IntelligenceErrorCode, message: string) {
    super(message);
    this.name = "IntelligenceError";
    this.code = code;
  }
}

export interface GenerateIntelligenceOptions extends AIGenerateOptions {
  promptVersion?: string;
}

export interface GenerateIntelligenceResult {
  output: LeadIntelligenceOutput;
  warnings: string[];
  model: string;
  promptVersion: string;
  schemaVersion: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** True when there is enough verified data to analyze (no fabrication). */
export function hasSufficientData(input: ConstrainedAIInput): boolean {
  if (input.websiteInspection || input.googlePlaces) return true;
  const companyFields = input.company ? Object.keys(input.company).length : 0;
  return companyFields > 0 && Boolean(input.lead.website);
}

function stripCodeFences(text: string): string {
  const t = text.trim();
  if (t.startsWith("```")) {
    const withoutOpen = t.replace(/^```(?:json)?\s*/i, "");
    return withoutOpen.replace(/\s*```\s*$/, "");
  }
  return t;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(stripCodeFences(text));
  } catch {
    // Try to salvage the first {...} block.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new IntelligenceError("INVALID_RESPONSE", "AI returned invalid JSON.");
  }
}

/**
 * Drop inferences/signals whose evidence cites fields that were never
 * supplied to the model. Records a warning per dropped item.
 */
export function filterInvalidEvidence<
  T extends { evidence: EvidenceRef[]; statement: string },
>(items: T[], allowed: Set<string>, warnings: string[]): T[] {
  return items.filter((item) => {
    const bad = item.evidence.filter(
      (e) => !allowed.has(`${e.sourceType}:${e.field}`),
    );
    if (bad.length > 0) {
      warnings.push(
        `Dropped unsupported inference (cited unavailable evidence ` +
          `${bad.map((b) => `${b.sourceType}:${b.field}`).join(", ")}): ` +
          `"${item.statement.slice(0, 80)}"`,
      );
      return false;
    }
    return true;
  });
}

export async function generateLeadIntelligence(
  lead: AIInputLead,
  company: AIInputCompany | null,
  inspection: AIInputInspection | null,
  options: GenerateIntelligenceOptions = {},
): Promise<GenerateIntelligenceResult> {
  const input = buildConstrainedInput(lead, company, inspection);

  if (!hasSufficientData(input)) {
    throw new IntelligenceError(
      "INSUFFICIENT_DATA",
      "Not enough verified data to generate intelligence. Run website inspection first.",
    );
  }

  if (!isAIConfigured(options.apiKey)) {
    throw new IntelligenceError("NOT_CONFIGURED", "AI Intelligence is not configured.");
  }

  const promptVersion = options.promptVersion ?? PROMPT_VERSION;
  const { system, user } = buildPrompt(input);
  const allowedRefs = getAllowedEvidenceRefs(input);
  const warnings: string[] = [];

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const gen = await generateJson(system, user, options);
      const parsed = parseJson(gen.text);
      const validated = leadIntelligenceOutputSchema.safeParse(parsed);
      if (!validated.success) {
        lastErr = new IntelligenceError(
          "SCHEMA_ERROR",
          "AI response failed schema validation.",
        );
        continue; // retry once
      }
      const output = validated.data;

      // Evidence-reference guard: every cited field must have been supplied.
      output.verifiedSignals = filterInvalidEvidence(
        output.verifiedSignals,
        allowedRefs,
        warnings,
      );
      output.inferredOpportunities = filterInvalidEvidence(
        output.inferredOpportunities,
        allowedRefs,
        warnings,
      );
      output.recommendedServices = filterInvalidEvidence(
        output.recommendedServices,
        allowedRefs,
        warnings,
      );
      output.summary.evidence = output.summary.evidence.filter((e) =>
        allowedRefs.has(`${e.sourceType}:${e.field}`),
      );
      output.salesAngle.evidence = output.salesAngle.evidence.filter((e) =>
        allowedRefs.has(`${e.sourceType}:${e.field}`),
      );
      output.evidence = output.evidence.filter((e) =>
        allowedRefs.has(`${e.sourceType}:${e.field}`),
      );
      if (output.summary.evidence.length === 0 || output.salesAngle.evidence.length === 0) {
        warnings.push(
          "Summary or sales angle lost all evidence references after validation.",
        );
      }

      return {
        output,
        warnings,
        model: gen.model,
        promptVersion,
        schemaVersion: "v1",
        usage: gen.usage,
      };
    } catch (err) {
      if (err instanceof AIProviderError) {
        throw new IntelligenceError(err.code as IntelligenceErrorCode, err.message);
      }
      if (err instanceof IntelligenceError && err.code === "INVALID_RESPONSE") {
        lastErr = err;
        continue; // retry once on malformed JSON
      }
      throw err;
    }
  }
  throw lastErr instanceof IntelligenceError
    ? lastErr
    : new IntelligenceError("SCHEMA_ERROR", "AI response failed schema validation.");
}

export { getAIModelName };
