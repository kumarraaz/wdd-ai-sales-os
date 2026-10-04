/**
 * Meta (Instagram/Facebook) integration — architecture only.
 *
 * What this provider does:
 * - Reports whether the Meta app credentials are configured
 *   (META_APP_ID + META_APP_SECRET, server-side only).
 * - Declares capabilities honestly: the official Meta APIs do NOT expose
 *   consumer business discovery, and this app will not scrape
 *   Instagram/Facebook, build fake accounts, or auto-send cold DMs.
 *
 * What the app DOES support (manual, user-driven):
 * - Connect my Meta account (OAuth — see META_REDIRECT_URI).
 * - Outbound profile linking: open a lead's Instagram/Facebook profile URL.
 * - Message draft + manual send: AI generates a message, the user copies
 *   it and pastes it into Instagram/Facebook themselves.
 *
 * search() always throws SEARCH_UNSUPPORTED with a clear reason — the UI
 * renders "Permission not available", never fake results.
 */
import {
  DiscoveryError,
  type DiscoveryQuery,
  type DiscoveryResult,
  type LeadDiscoveryProvider,
  type ProviderCapabilities,
} from "../types";
import type { LeadSourceType } from "@prisma/client";

function readEnv(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}

export const META_DISCOVERY_UNSUPPORTED_REASON =
  "Meta's official APIs do not support business/prospect discovery from consumer Instagram or Facebook accounts. " +
  "This app will not scrape profiles or bypass Meta permissions. " +
  "Use manual profile linking + copied message drafts instead.";

export class MetaProvider implements LeadDiscoveryProvider {
  readonly id = "meta";
  readonly label = "Meta (Instagram / Facebook)";
  readonly sourceType: LeadSourceType = "META";
  readonly searchable = false;
  readonly capabilities: ProviderCapabilities = {
    websiteAuthority: "unreliable",
    supportsPhone: false,
    supportsEmail: false,
    supportsSocial: true,
    supportsPagination: false,
    supportsRecentEvidence: false,
    discoverySupported: false,
    discoveryUnsupportedReason: META_DISCOVERY_UNSUPPORTED_REASON,
  };

  /** App credentials configured (server-side). Never exposed to the browser. */
  isConfigured(): boolean {
    return !!readEnv("META_APP_ID") && !!readEnv("META_APP_SECRET");
  }

  setupInstructions(): string[] {
    return [
      "Create an app at developers.facebook.com and add the Instagram/Facebook Login products.",
      'Set META_APP_ID, META_APP_SECRET, and META_REDIRECT_URI="<https-callback-url>" in your server environment.',
      "Complete the OAuth connect flow from the Integrations page.",
      "Note: Meta's official APIs do not permit automated prospect discovery or cold DM sending — outreach stays manual (open profile + copy message).",
    ];
  }

  async search(_query: DiscoveryQuery): Promise<DiscoveryResult> {
    throw new DiscoveryError(
      "SEARCH_UNSUPPORTED",
      META_DISCOVERY_UNSUPPORTED_REASON,
    );
  }
}
