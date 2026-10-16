import localFont from "next/font/local";

/**
 * Inter (variable, latin subset), self-hosted so builds never need network
 * access and every device (including Android, which ships without Inter)
 * renders the same typeface as the Figma design.
 *
 * Licensed under the SIL Open Font License 1.1 — see ./Inter-OFL.txt.
 * Exposed as the --font-inter CSS variable; the app shell opts in via the
 * `font-ui` utility so marketing and auth pages are unchanged.
 */
export const inter = localFont({
  src: "./inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900",
  style: "normal",
  display: "swap",
});
