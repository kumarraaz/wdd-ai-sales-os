import { sendEmail } from "./email";

export interface VerificationEmailTaskInput {
  to: string;
  url: string;
}

/**
 * Builds the verification-email background task.
 *
 * Better Auth invokes `emailVerification.sendVerificationEmail` and manages
 * the returned promise through its `advanced.backgroundTasks` mechanism
 * (`waitUntil` on Vercel, awaited inline elsewhere). The task carries its own
 * `[auth-email]` diagnostic logging so a silent failure is always visible in
 * server logs.
 *
 * Never logs: the recipient address, the verification token, the full
 * verification URL, or any secret. Only the safe error message is logged.
 */
export function verificationEmailTask({ to, url }: VerificationEmailTaskInput): Promise<void> {
  console.log("[auth-email] verification email requested");
  return (async () => {
    console.log("[auth-email] verification email task started");
    try {
      await sendEmail({
        to,
        subject: "Verify your WDD AI Sales OS account",
        html: `<p>Welcome! Verify your email to activate your workspace:</p><p><a href="${url}">${url}</a></p>`,
        text: `Verify your email: ${url}`,
      });
      console.log("[auth-email] verification email task completed");
    } catch (err) {
      // sendEmail never puts secrets in its messages; still, only the message
      // text is logged — never the error object, token, or URL.
      const safe = err instanceof Error ? err.message : "Unknown email error";
      console.error("[auth-email] verification email task failed:", safe);
      throw err;
    }
  })();
}
