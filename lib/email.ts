const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

// Fail-fast visibility: in production, verification emails cannot work
// without both variables. Warn once at startup (server-only module) because
// Better Auth swallows per-signup send failures. Never log secret values.
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.BREVO_API_KEY || !process.env.EMAIL_FROM)
) {
  console.warn(
    "[email] Brevo email is not fully configured — set BREVO_API_KEY and " +
      "EMAIL_FROM (a Brevo-verified sender) or verification emails will fail.",
  );
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Parse a sender like "WDD AI Sales OS <noreply@yourdomain.com>" (or a bare
 * address) into Brevo's { name?, email } sender object.
 */
function parseSender(from: string): { name?: string; email: string } {
  const m = from.match(/^(.*)<([^<>]+)>\s*$/);
  if (m) {
    const name = m[1].trim().replace(/^["']|["']$/g, "");
    return { ...(name ? { name } : {}), email: m[2].trim() };
  }
  return { email: from.trim() };
}

/**
 * Transactional email sender (Brevo).
 * - Requires BREVO_API_KEY; requires EMAIL_FROM.
 * - Development without a key: logs the email to the server console so auth
 *   flows (verification, password reset) remain testable. NEVER do this in
 *   production — the guard below enforces it.
 * - Never logs or throws the API key.
 */
export async function sendEmail({ to, subject, html, text }: SendEmailInput) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("EMAIL_NOT_CONFIGURED: BREVO_API_KEY is missing");
    }
    console.log(`[dev-email] To: ${to}\nSubject: ${subject}\n${text ?? html}`);
    return;
  }

  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_NOT_CONFIGURED: EMAIL_FROM is missing");
  }

  console.log("[email] Sending verification email via Brevo", { to });

  let res: Response;
  try {
    res = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        sender: parseSender(from),
        to: [{ email: to }],
        subject,
        htmlContent: html,
        ...(text ? { textContent: text } : {}),
      }),
    });
  } catch (err) {
    // Network-level failure — err.message never contains the key (it was only
    // ever sent as a header value).
    const message = err instanceof Error ? err.message : "Network request failed";
    console.error("[email] Brevo rejected email:", message, { to });
    throw new Error(`Email send failed: ${message}`);
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let detail = "";
    try {
      const data = JSON.parse(raw) as { message?: unknown };
      if (typeof data.message === "string" && data.message) {
        detail = `: ${data.message}`;
      }
    } catch {
      // Non-JSON error body — keep the status only.
    }
    const safeMessage = `Brevo API error ${res.status}${detail}`;
    console.error("[email] Brevo rejected email:", safeMessage, { to });
    throw new Error(`Email send failed: ${safeMessage}`);
  }

  console.log("[email] Brevo accepted email", { to });
}

export function appUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}
