import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM = process.env.EMAIL_FROM || "WDD AI Sales OS <noreply@wdd.example.com>";

// Fail-fast visibility: in production the fallback address above can never
// work — its domain is not verifiable in Resend, so every send would be
// rejected. Warn once at startup (server-only module) instead of failing
// silently per signup. Never log the API key.
if (process.env.NODE_ENV === "production" && !process.env.EMAIL_FROM) {
  console.warn(
    "[email] EMAIL_FROM is not set — falling back to an unverifiable address. " +
      "Set EMAIL_FROM to a Resend-verified address, e.g. \"WDD AI Sales OS <noreply@yourdomain.com>\".",
  );
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Transactional email sender.
 * - Production: requires RESEND_API_KEY (throws if missing).
 * - Development without a key: logs the email to the server console so auth
 *   flows (verification, password reset) remain testable. NEVER do this in
 *   production — the guard below enforces it.
 */
export async function sendEmail({ to, subject, html, text }: SendEmailInput) {
  if (resend) {
    const { error } = await resend.emails.send({ from: FROM, to, subject, html, text });
    if (error) {
      // Better Auth swallows sendVerificationEmail errors (logs "Failed to run
      // background task" only), so log the actionable context here: recipient,
      // from-address, and Resend's own message. Never log the API key.
      console.error("[email] Resend rejected the send", {
        to,
        from: FROM,
        error: error.message,
      });
      throw new Error(`Email send failed: ${error.message}`);
    }
    return;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("EMAIL_NOT_CONFIGURED");
  }
  console.log(`[dev-email] To: ${to}\nSubject: ${subject}\n${text ?? html}`);
}

export function appUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}
