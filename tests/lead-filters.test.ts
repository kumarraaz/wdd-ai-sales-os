import { describe, expect, it } from "vitest";
import {
  EMPTY_LEAD_FILTERS,
  activeFilterCount,
  leadFiltersToParams,
  parseLeadFilters,
} from "@/lib/lead-filters";
import { listLeadsQuerySchema } from "@/lib/validators";

const parse = (qs: string) => parseLeadFilters(new URLSearchParams(qs));

describe("parseLeadFilters", () => {
  it("reads every supported filter", () => {
    expect(
      parse("q=acme&status=QUALIFIED&sourceType=CSV&verification=HIGH&minScore=80&followUp=due&contactable=true&websiteStatus=NO_WEBSITE&page=3"),
    ).toEqual({
      q: "acme",
      status: "QUALIFIED",
      sourceType: "CSV",
      verification: "HIGH",
      minScore: "80",
      followUp: "due",
      contactable: "true",
      websiteStatus: "NO_WEBSITE",
      page: 3,
    });
  });

  it("is empty for a bare /leads", () => {
    expect(parse("")).toEqual(EMPTY_LEAD_FILTERS);
  });

  it("drops anything that is not a known value instead of passing it to the API", () => {
    const f = parse("status=HACKED&sourceType=x&verification=maybe&minScore=999&followUp=overdue&contactable=false&websiteStatus=yes&page=-4");
    expect(f).toEqual(EMPTY_LEAD_FILTERS);
    expect(parse("minScore=7.5").minScore).toBe("");
    expect(parse("minScore=abc").minScore).toBe("");
    expect(parse("page=2.5").page).toBe(1);
    expect(parse("page=abc").page).toBe(1);
  });

  it("normalises a score and trims/limits the search text", () => {
    expect(parse("minScore=007").minScore).toBe("7");
    expect(parse("q=%20%20hello%20").q).toBe("hello");
    expect(parse(`q=${"a".repeat(500)}`).q).toHaveLength(200);
  });
});

describe("leadFiltersToParams", () => {
  it("round-trips and omits defaults", () => {
    const f = parse("status=NEW&minScore=80&page=2");
    expect(leadFiltersToParams(f).toString()).toBe("status=NEW&minScore=80&page=2");
    expect(parse(leadFiltersToParams(f).toString())).toEqual(f);
    expect(leadFiltersToParams(EMPTY_LEAD_FILTERS).toString()).toBe("");
  });

  it("encodes the search text", () => {
    const qs = leadFiltersToParams({ ...EMPTY_LEAD_FILTERS, q: "a&b=c d" }).toString();
    expect(parse(qs).q).toBe("a&b=c d");
  });

  it("produces queries the leads API accepts (dashboard drill-down links included)", () => {
    for (const qs of [
      "minScore=80&status=NEW",
      "followUp=due",
      "contactable=true",
      "websiteStatus=NO_WEBSITE",
      "status=WON",
    ]) {
      const f = parse(qs);
      const params = leadFiltersToParams(f);
      params.set("pageSize", "25");
      expect(listLeadsQuerySchema.safeParse(Object.fromEntries(params)).success).toBe(true);
    }
  });
});

describe("activeFilterCount", () => {
  it("counts narrowing filters but not the page", () => {
    expect(activeFilterCount(parse("page=4"))).toBe(0);
    expect(activeFilterCount(parse("status=NEW&followUp=due&page=4"))).toBe(2);
  });
});
