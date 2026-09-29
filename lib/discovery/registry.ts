/**
 * Discovery provider registry. New compliant providers are added here —
 * application code depends on the LeadDiscoveryProvider interface, never on
 * a concrete provider.
 */
import { CsvImportProvider } from "./csv-import";
import { GooglePlacesProvider } from "./google-places";
import type { LeadDiscoveryProvider } from "./types";

const providers: LeadDiscoveryProvider[] = [
  new GooglePlacesProvider(),
  new CsvImportProvider(),
];

export function listDiscoveryProviders(): LeadDiscoveryProvider[] {
  return [...providers];
}

export function getDiscoveryProvider(id: string): LeadDiscoveryProvider | undefined {
  return providers.find((p) => p.id === id);
}
