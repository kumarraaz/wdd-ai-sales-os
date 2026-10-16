/** Period-over-period change chip shown on KPI tiles. The label is preformatted by the caller. */
export interface Trend {
  /** e.g. "+18.6%", "New", "+3.2 pts" */
  label: string;
  direction: "up" | "down" | "flat";
}
