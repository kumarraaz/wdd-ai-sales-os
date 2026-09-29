/**
 * Verification-email task tests.
 *
 * Proves: the task built for Better Auth's `sendVerificationEmail` actually
 * invokes `sendEmail()` with the verification template, emits the
 * [auth-email] diagnostic lifecycle logs without leaking the recipient,
 * token, URL, or secrets, and that lib/auth.ts wires the task plus the
 * Vercel `waitUntil` background handler into Better Auth.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));
vi.mock("../lib/email", () => ({
  sendEmail: vi.fn(),
  appUrl: () => "http://localhost:3000",
}));

import { waitUntil } from "@vercel/functions";
import { sendEmail } from "../lib/email";
import { verificationEmailTask } from "../lib/verification-email";
// Importing lib/auth pulls the real Better Auth instance (DB adapter is lazy,
// no connection is made). Env is stubbed per-test below.
import { auth } from "../lib/auth";

const sendEmailMock = vi.mocked(sendEmail);
const waitUntilMock = vi.mocked(waitUntil);

const TO = "newuser@example.com";
const URL = "http://localhost:3000/verify-email?token=secret-token-123&callbackURL=%2F";

function loggedText(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((c) => JSON.stringify(c)).join("\n");
}

beforeEach(() => {
  vi.stubEnv("BREVO_API_KEY", "xkeysib-test-key");
  vi.stubEnv("EMAIL_FROM", "WDD AI Sales OS <noreply@yourdomain.com>");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("verificationEmailTask", () => {
  it("invokes sendEmail with the verification template", async () => {
    sendEmailMock.mockResolvedValueOnce(undefined);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await verificationEmailTask({ to: TO, url: URL });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const input = sendEmailMock.mock.calls[0][0];
    expect(input.to).toBe(TO);
    expect(input.subject).toBe("Verify your WDD AI Sales OS account");
    expect(input.html).toContain(URL);
    expect(input.text).toContain(URL);
  });

  it("logs the requested/started/completed lifecycle", async () => {
    sendEmailMock.mockResolvedValueOnce(undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await verificationEmailTask({ to: TO, url: URL });

    const out = loggedText(log);
    const requested = out.indexOf("[auth-email] verification email requested");
    const started = out.indexOf("[auth-email] verification email task started");
    const completed = out.indexOf("[auth-email] verification email task completed");
    expect(requested).toBeGreaterThanOrEqual(0);
    expect(started).toBeGreaterThan(requested);
    expect(completed).toBeGreaterThan(started);
  });

  it("never logs the recipient, token, URL, or secrets", async () => {
    sendEmailMock.mockResolvedValueOnce(undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await verificationEmailTask({ to: TO, url: URL });

    const out = loggedText(log) + loggedText(err);
    expect(out).not.toContain(TO);
    expect(out).not.toContain("secret-token-123");
    expect(out).not.toContain(URL);
    expect(out).not.toContain("xkeysib-test-key");
  });

  it("logs task failure with the safe message and rethrows", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("EMAIL_NOT_CONFIGURED: BREVO_API_KEY is missing"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(verificationEmailTask({ to: TO, url: URL })).rejects.toThrow(
      "EMAIL_NOT_CONFIGURED: BREVO_API_KEY is missing",
    );

    const out = loggedText(err);
    expect(out).toContain("[auth-email] verification email task failed:");
    expect(out).toContain("EMAIL_NOT_CONFIGURED: BREVO_API_KEY is missing");
    expect(out).not.toContain("secret-token-123");
    expect(out).not.toContain(URL);
  });
});

describe("lib/auth.ts wiring", () => {
  it("exposes sendVerificationEmail that invokes sendEmail", async () => {
    sendEmailMock.mockResolvedValueOnce(undefined);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const send = auth.options.emailVerification?.sendVerificationEmail;
    expect(send).toBeDefined();
    await send!({ user: { email: TO }, url: URL, token: "secret-token-123" } as never);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toBe(TO);
  });

  it("wires the Vercel waitUntil background-task handler", () => {
    const handler = auth.options.advanced?.backgroundTasks?.handler;
    expect(handler).toBeDefined();

    const task = Promise.resolve("done");
    handler!(task);
    expect(waitUntilMock).toHaveBeenCalledTimes(1);
    expect(waitUntilMock).toHaveBeenCalledWith(task);
  });
});
