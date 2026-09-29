/**
 * Brevo transactional email tests — no real API calls.
 *
 * Covers: missing BREVO_API_KEY, missing EMAIL_FROM, successful Brevo
 * response (request shape), Brevo non-2xx responses, network failures, the
 * API key never appearing in logs or thrown errors, the dev-mode console
 * fallback, and the sendEmail interface contract that lib/auth.ts relies on
 * for verification emails (subject/html passed through unchanged).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { sendEmail } from "../lib/email";

const API_KEY = "xkeysib-test-key-do-not-use";
const FROM = "WDD AI Sales OS <noreply@yourdomain.com>";
const TO = "newuser@example.com";

function mockFetchOnce(response: Partial<Response> | Error) {
  const fetchMock = vi.fn();
  if (response instanceof Error) {
    fetchMock.mockRejectedValueOnce(response);
  } else {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: async () => "",
      ...response,
    });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function validEnv() {
  vi.stubEnv("BREVO_API_KEY", API_KEY);
  vi.stubEnv("EMAIL_FROM", FROM);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendEmail — configuration validation", () => {
  it("throws an actionable error when BREVO_API_KEY is missing in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_FROM", FROM);
    await expect(
      sendEmail({ to: TO, subject: "s", html: "<p>h</p>" }),
    ).rejects.toThrow("EMAIL_NOT_CONFIGURED: BREVO_API_KEY is missing");
  });

  it("throws an actionable error when EMAIL_FROM is missing", async () => {
    validEnv();
    vi.stubEnv("EMAIL_FROM", "");
    await expect(
      sendEmail({ to: TO, subject: "s", html: "<p>h</p>" }),
    ).rejects.toThrow("EMAIL_NOT_CONFIGURED: EMAIL_FROM is missing");
  });

  it("logs to console instead of sending in development without a key", async () => {
    vi.stubEnv("EMAIL_FROM", FROM);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await sendEmail({ to: TO, subject: "Verify", html: "<p>hi</p>" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    expect(log.mock.calls.join(" ")).toContain(TO);
  });
});

describe("sendEmail — Brevo API", () => {
  it("sends the correct Brevo request shape on success", async () => {
    validEnv();
    const fetchMock = mockFetchOnce({ ok: true, status: 201 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await sendEmail({ to: TO, subject: "Verify your account", html: "<p>click</p>", text: "click" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect((init.headers as Record<string, string>)["api-key"]).toBe(API_KEY);

    const body = JSON.parse(init.body as string);
    // Sender display name is preserved, address extracted for Brevo.
    expect(body.sender).toEqual({ name: "WDD AI Sales OS", email: "noreply@yourdomain.com" });
    expect(body.to).toEqual([{ email: TO }]);
    // Existing verification email template contract: subject/html/text pass through.
    expect(body.subject).toBe("Verify your account");
    expect(body.htmlContent).toBe("<p>click</p>");
    expect(body.textContent).toBe("click");

    expect(log.mock.calls.join(" ")).toContain("[email] Brevo accepted email");
  });

  it("parses a bare sender address without a display name", async () => {
    vi.stubEnv("BREVO_API_KEY", API_KEY);
    vi.stubEnv("EMAIL_FROM", "noreply@yourdomain.com");
    const fetchMock = mockFetchOnce({ ok: true, status: 201 });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await sendEmail({ to: TO, subject: "s", html: "h" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.sender).toEqual({ email: "noreply@yourdomain.com" });
  });

  it("throws an actionable error on Brevo non-2xx with the safe message", async () => {
    validEnv();
    const fetchMock = mockFetchOnce({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ message: "Key not valid", code: "unauthorized" }),
    });
    const errLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const promise = sendEmail({ to: TO, subject: "s", html: "h" });
    await expect(promise).rejects.toThrow("Brevo API error 401: Key not valid");

    const thrown = (await promise.catch((e: unknown) => e)) as Error;
    expect(thrown.message).not.toContain(API_KEY);

    const logged = errLog.mock.calls.map((c) => JSON.stringify(c)).join(" ");
    expect(logged).toContain("[email] Brevo rejected email:");
    expect(logged).not.toContain(API_KEY);
  });

  it("handles non-JSON Brevo error bodies with status only", async () => {
    validEnv();
    mockFetchOnce({ ok: false, status: 500, text: async () => "<html>oops</html>" });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendEmail({ to: TO, subject: "s", html: "h" })).rejects.toThrow(
      "Brevo API error 500",
    );
  });

  it("throws a safe error on network failure without leaking the key", async () => {
    validEnv();
    mockFetchOnce(new Error("fetch failed"));
    const errLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const thrown = (await sendEmail({ to: TO, subject: "s", html: "h" }).catch(
      (e: unknown) => e,
    )) as Error;
    expect(thrown.message).toContain("Email send failed");
    expect(thrown.message).not.toContain(API_KEY);

    const logged = errLog.mock.calls.map((c) => JSON.stringify(c)).join(" ");
    expect(logged).not.toContain(API_KEY);
  });
});
