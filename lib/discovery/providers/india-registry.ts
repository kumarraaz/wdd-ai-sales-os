/**
 * India Government Company Registry — optional evidence provider.
 *
 * Intended role: merge OFFICIAL registration evidence (company name, CIN,
 * status, registered state/office, business activity, registration date)
 * with contact/business discovery from other sources. Registry data is
 * never treated as a phone database.
 *
 * Current state: there is NO free public MCA (Ministry of Corporate
 * Affairs) API suitable for automated lookup, so this provider ships as
 * an honest NOT_CONFIGURED stub. The interface, merge logic, and UI
 * slots are ready; when an official or licensed registry API is
 * contracted, implement search() against it here.
 *
 * search() always throws SEARCH_UNSUPPORTED until a real API is wired —
 * the UI renders "Not configured", never fake registry data.
 */
import {
  DiscoveryError,
  type DiscoveryQuery,
  type DiscoveryResult,
  type LeadDiscoveryProvider,
  type ProviderCapabilities,
} from "../types";
import type { LeadSourceType } from "@prisma/client";

export const REGISTRY_NOT_CONFIGURED_REASON =
  "No government registry API is configured. The MCA portal (mca.gov.in) offers no free public API for automated company lookup — " +
  "registration evidence must be checked manually there for now.";

export class IndiaRegistryProvider implements LeadDiscoveryProvider {
  readonly id = "india-registry";
  readonly label = "India Company Registry";
  readonly sourceType: LeadSourceType = "GOVERNMENT_REGISTRY";
  readonly searchable = false;
  readonly capabilities: ProviderCapabilities = {
    websiteAuthority: "unreliable",
    supportsPhone: false,
    supportsEmail: false,
    supportsSocial: false,
    supportsPagination: false,
    supportsRecentEvidence: true,
    discoverySupported: false,
    discoveryUnsupportedReason: REGISTRY_NOT_CONFIGURED_REASON,
  };

  isConfigured(): boolean {
    return false;
  }

  setupInstructions(): string[] {
    return [
      "There is currently no free public MCA API for automated company lookup.",
      "To wire a licensed registry API later, implement search() in lib/discovery/providers/india-registry.ts against the provider's official API.",
      "Until then, verify registration manually at mca.gov.in and record the CIN/status on the lead.",
    ];
  }

  async search(_query: DiscoveryQuery): Promise<DiscoveryResult> {
    throw new DiscoveryError("SEARCH_UNSUPPORTED", REGISTRY_NOT_CONFIGURED_REASON);
  }
}
