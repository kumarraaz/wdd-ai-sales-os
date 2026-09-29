/**
 * CSV import provider — adapts user-supplied CSV rows into the normalized
 * DiscoveredCompany shape so they can flow through the same import/dedup
 * pipeline as API-discovered companies.
 *
 * CSV is not a *search* provider (there is nothing to query), so search()
 * throws SEARCH_UNSUPPORTED. The existing /api/leads/import endpoint is
 * untouched — this adapter is for programmatic use and future UI flows.
 * Provenance is always USER_PROVIDED for CSV rows.
 */
import {
  DiscoveryError,
  type DiscoveredCompany,
  type DiscoveryQuery,
  type DiscoveryResult,
  type LeadDiscoveryProvider,
} from "./types";

export interface CsvRowMapping {
  name?: string;
  category?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  website?: string;
  sourceUrl?: string;
}

function cell(row: Record<string, string>, col: string | undefined): string | undefined {
  if (!col) return undefined;
  const v = row[col]?.trim();
  return v || undefined;
}

export class CsvImportProvider implements LeadDiscoveryProvider {
  readonly id = "csv-import";
  readonly label = "CSV Import";
  readonly sourceType = "CSV" as const;
  readonly searchable = false;

  isConfigured(): boolean {
    return true; // no external credentials needed
  }

  setupInstructions(): string[] {
    return ["No setup required — upload a CSV file to import rows."];
  }

  search(_query: DiscoveryQuery): Promise<DiscoveryResult> {
    throw new DiscoveryError(
      "SEARCH_UNSUPPORTED",
      "CSV import does not support search. Upload rows to ingest them instead.",
    );
  }

  /**
   * Convert parsed CSV rows + column mapping into normalized companies.
   * providerId is synthesized from row content (csv:<index>:<hash>) — it is
   * a local ingest marker, never presented as a verified provider id.
   */
  ingestRows(
    rows: Record<string, string>[],
    mapping: CsvRowMapping,
  ): DiscoveredCompany[] {
    const companies: DiscoveredCompany[] = [];
    rows.forEach((row, i) => {
      const name = cell(row, mapping.name);
      if (!name) return; // name is required
      const company: DiscoveredCompany = {
        provider: this.id,
        providerId: `csv:row:${i + 1}`,
        name,
        provenance: "USER_PROVIDED",
        discoveredAt: new Date().toISOString(),
      };
      const category = cell(row, mapping.category);
      const address = cell(row, mapping.address);
      const city = cell(row, mapping.city);
      const state = cell(row, mapping.state);
      const country = cell(row, mapping.country);
      const phone = cell(row, mapping.phone);
      const website = cell(row, mapping.website);
      const sourceUrl = cell(row, mapping.sourceUrl);
      if (category) company.category = category;
      if (address) company.address = address;
      if (city) company.city = city;
      if (state) company.state = state;
      if (country) company.country = country;
      if (phone) company.phone = phone;
      if (website) company.website = website;
      if (sourceUrl) company.sourceUrl = sourceUrl;
      companies.push(company);
    });
    return companies;
  }
}
