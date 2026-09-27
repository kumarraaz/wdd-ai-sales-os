import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM = process.env.EMAIL_FROM || "WDD AI Sales OS <noreply@wdd.example.com>";

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
    if (error) throw new Error(`Email send failed: ${error.message}`);
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
