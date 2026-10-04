/**
 * Discovery provider registry. New compliant providers are added here —
 * application code depends on the LeadDiscoveryProvider interface, never on
 * a concrete provider.
 */
import { CsvImportProvider } from "./csv-import";
import { GooglePlacesProvider } from "./google-places";
import { OpenStreetMapProvider } from "./openstreetmap";
import { GeoapifyProvider } from "./providers/geoapify";
import { TavilyProvider } from "./providers/tavily";
import { GeminiGroundingProvider } from "./providers/gemini-grounding";
import { MetaProvider } from "./providers/meta";
import { IndiaRegistryProvider } from "./providers/india-registry";
import type { LeadDiscoveryProvider } from "./types";

const providers: LeadDiscoveryProvider[] = [
  new OpenStreetMapProvider(),
  new GooglePlacesProvider(),
  new GeoapifyProvider(),
  new TavilyProvider(),
  new GeminiGroundingProvider(),
  new MetaProvider(),
  new IndiaRegistryProvider(),
  new CsvImportProvider(),
];

export function listDiscoveryProviders(): LeadDiscoveryProvider[] {
  return [...providers];
}

export function getDiscoveryProvider(id: string): LeadDiscoveryProvider | undefined {
  return providers.find((p) => p.id === id);
}

/** Providers that can actually run discovery searches. */
export function listSearchableProviders(): LeadDiscoveryProvider[] {
  return providers.filter((p) => p.searchable);
}
