/**
 * Demo mode safety tests — no database required.
 *
 * These tests are the executable proof of the demo-mode safety contract:
 *  1. Demo mode works ONLY when explicitly enabled (DEMO_MODE=true).
 *  2. Demo mode can NEVER activate when NODE_ENV=production.
 *  3. Protected production routes (withWorkspace) stay protected when
 *     DEMO_MODE is false — and a demo token can never satisfy them.
 *  4. All write/outreach-capable demo API actions are blocked with
 *     "Demo Mode — Action Disabled".
 *  5. No secrets (API keys, DB credentials, auth secrets) reach the client
 *     through any demo-mode surface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Controllable next/headers mock. Route handlers under test call cookies();
// lib/tenant calls headers(). Declared with vi.hoisted so the factory below
// (which is hoisted above imports) can close over the same state.
// ---------------------------------------------------------------------------
const { jar, setCalls } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  setCalls: [] as { name: string; value: string; opts?: Record<string, unknown> }[],
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const v = jar.get(name);
      return v === undefined ? undefined : { value: v };
    },
    set: (name: string, value: string, opts?: Record<string, unknown>) => {
      jar.set(name, value);
      setCalls.push({ name, value, opts });
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  })),
  headers: vi.fn(async () => new Headers()),
}));

import {
  DEMO_ACTION_DISABLED_MESSAGE,
  DEMO_COOKIE_NAME,
  createDemoSession,
  destroyDemoSession,
  isDemoModeEnabled,
  validateDemoSession,
} from "../lib/demo";
import { DEMO_LEADS, getDemoDashboard } from "../lib/demo-data";
import { POST as demoEnter } from "../app/api/demo/enter/route";
import { POST as demoExit } from "../app/api/demo/exit/route";
import {
  DELETE as demoLeadsDelete,
  GET as demoLeadsGet,
  POST as demoLeadsPost,
} from "../app/api/demo/leads/route";
import { PATCH as demoLeadPatch } from "../app/api/demo/leads/[id]/route";
import { withWorkspace } from "../lib/tenant";

function enableDemo() {
  vi.stubEnv("DEMO_MODE", "true");
}

function disableDemo() {
  vi.stubEnv("DEMO_MODE", "false");
}

/** Seed the mocked cookie jar with a valid demo session; returns the token. */
function seedDemoCookie(): string {
  enableDemo();
  const token = createDemoSession();
  if (!token) throw new Error("test setup: demo session creation failed");
  jar.set(DEMO_COOKIE_NAME, token);
  return token;
}

beforeEach(() => {
  jar.clear();
  setCalls.length = 0;
  delete process.env.DEMO_MODE;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
describe("demo mode gate", () => {
  it("is disabled by default (DEMO_MODE unset)", () => {
    expect(isDemoModeEnabled()).toBe(false);
  });

  it("is disabled when DEMO_MODE=false", () => {
    disableDemo();
    expect(isDemoModeEnabled()).toBe(false);
  });

  it("is enabled when DEMO_MODE=true outside production", () => {
    enableDemo();
    expect(isDemoModeEnabled()).toBe(true);
  });

  it("can NEVER activate in production, even with DEMO_MODE=true", () => {
    enableDemo();
    vi.stubEnv("NODE_ENV", "production");
    expect(isDemoModeEnabled()).toBe(false);
  });

  it("ignores truthy-but-not-true values", () => {
    vi.stubEnv("DEMO_MODE", "1");
    expect(isDemoModeEnabled()).toBe(false);
    vi.stubEnv("DEMO_MODE", "yes");
    expect(isDemoModeEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("demo sessions", () => {
  it("createDemoSession returns null when demo mode is disabled", () => {
    disableDemo();
    expect(createDemoSession()).toBeNull();
  });

  it("round-trips: a created token validates", () => {
    enableDemo();
    const token = createDemoSession();
    expect(token).toBeTruthy();
    expect(validateDemoSession(token)).toBe(true);
  });

  it("rejects forged, empty, and undefined tokens", () => {
    enableDemo();
    expect(validateDemoSession("forged-token")).toBe(false);
    expect(validateDemoSession("")).toBe(false);
    expect(validateDemoSession(undefined)).toBe(false);
    expect(validateDemoSession(null)).toBe(false);
  });

  it("existing tokens stop validating the moment demo mode is disabled", () => {
    enableDemo();
    const token = createDemoSession();
    expect(validateDemoSession(token)).toBe(true);
    disableDemo();
    expect(validateDemoSession(token)).toBe(false);
  });

  it("destroyDemoSession invalidates the token", () => {
    enableDemo();
    const token = createDemoSession();
    destroyDemoSession(token);
    expect(validateDemoSession(token)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/demo/enter", () => {
  it("returns 404 when demo mode is disabled", async () => {
    disableDemo();
    const res = await demoEnter();
    expect(res.status).toBe(404);
    expect(setCalls).toHaveLength(0);
  });

  it("returns 404 in production even with DEMO_MODE=true", async () => {
    enableDemo();
    vi.stubEnv("NODE_ENV", "production");
    const res = await demoEnter();
    expect(res.status).toBe(404);
    expect(setCalls).toHaveLength(0);
  });

  it("returns 200 and sets an HttpOnly demo cookie when enabled", async () => {
    enableDemo();
    const res = await demoEnter();
    expect(res.status).toBe(200);

    const call = setCalls.find((c) => c.name === DEMO_COOKIE_NAME);
    expect(call).toBeDefined();
    expect(call?.opts?.httpOnly).toBe(true);
    expect(call?.opts?.sameSite).toBe("lax");
    expect(call?.opts?.path).toBe("/");
    if (!call) throw new Error("test setup: cookie was not set");
    expect(validateDemoSession(call.value)).toBe(true);

    const body = await res.json();
    expect(body).toEqual({ ok: true, demo: true });
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/demo/exit", () => {
  it("destroys the session and clears the cookie", async () => {
    const token = seedDemoCookie();
    expect(validateDemoSession(token)).toBe(true);

    const res = await demoExit();
    expect(res.status).toBe(200);
    expect(validateDemoSession(token)).toBe(false);
    expect(jar.get(DEMO_COOKIE_NAME)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("demo leads fixture API", () => {
  it("GET returns 404 when demo mode is disabled", async () => {
    disableDemo();
    const res = await demoLeadsGet(new NextRequest("http://localhost/api/demo/leads"));
    expect(res.status).toBe(404);
  });

  it("GET returns 404 for a forged token (indistinguishable from missing)", async () => {
    enableDemo();
    jar.set(DEMO_COOKIE_NAME, "forged-token");
    const res = await demoLeadsGet(new NextRequest("http://localhost/api/demo/leads"));
    expect(res.status).toBe(404);
  });

  it("GET serves labeled DEMO_DATA fixtures with a valid session", async () => {
    seedDemoCookie();
    const res = await demoLeadsGet(new NextRequest("http://localhost/api/demo/leads"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(DEMO_LEADS.length);
    expect(body.leads).toHaveLength(DEMO_LEADS.length);
    expect(body.demo).toBe(true);
    for (const lead of body.leads) {
      expect(lead.dataLabel).toBe("DEMO_DATA");
    }
  });

  it("GET honors q, status, page, and pageSize", async () => {
    seedDemoCookie();
    const qRes = await demoLeadsGet(
      new NextRequest("http://localhost/api/demo/leads?q=aarav"),
    );
    const qBody = await qRes.json();
    expect(qBody.total).toBe(1);
    expect(qBody.leads[0].fullName).toBe("Aarav Mehta");

    const sRes = await demoLeadsGet(
      new NextRequest("http://localhost/api/demo/leads?status=NEW"),
    );
    const sBody = await sRes.json();
    expect(sBody.total).toBe(2);

    const pRes = await demoLeadsGet(
      new NextRequest("http://localhost/api/demo/leads?page=2&pageSize=5"),
    );
    const pBody = await pRes.json();
    expect(pBody.total).toBe(DEMO_LEADS.length);
    expect(pBody.leads).toHaveLength(5);
  });

  it("blocks collection mutations with Demo Mode — Action Disabled", async () => {
    seedDemoCookie();
    for (const call of [() => demoLeadsPost(), () => demoLeadsDelete()]) {
      const res = await call();
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(DEMO_ACTION_DISABLED_MESSAGE);
    }
  });

  it("blocks per-lead mutations (kanban move, row delete) with Action Disabled", async () => {
    seedDemoCookie();
    const res = await demoLeadPatch();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(DEMO_ACTION_DISABLED_MESSAGE);
  });

  it("mutations return 404 (not 403) when demo mode is disabled — no info leak", async () => {
    disableDemo();
    const res = await demoLeadsPost();
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe("production APIs stay protected", () => {
  function guardedRequest(cookieHeader?: string) {
    const headers: Record<string, string> = {};
    if (cookieHeader) headers.cookie = cookieHeader;
    const req = new NextRequest("http://localhost/api/leads", { headers });
    let handlerRan = false;
    const guarded = withWorkspace(async () => {
      handlerRan = true;
      return NextResponse.json({ ok: true });
    });
    return { req, guarded, wasHandlerRan: () => handlerRan };
  }

  it("rejects a request carrying only a valid demo cookie with 401", async () => {
    const token = seedDemoCookie(); // valid for demo...
    const { req, guarded, wasHandlerRan } = guardedRequest(
      `${DEMO_COOKIE_NAME}=${token}`,
    );
    const res = await guarded(req, { params: Promise.resolve({}) });
    // ...but it can never satisfy production auth.
    expect(res.status).toBe(401);
    expect(wasHandlerRan()).toBe(false);
  });

  it("rejects a request with no session cookie with 401", async () => {
    const { req, guarded, wasHandlerRan } = guardedRequest();
    const res = await guarded(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
    expect(wasHandlerRan()).toBe(false);
  });

  it("still rejects demo-cookie requests when DEMO_MODE is false", async () => {
    // A stale demo cookie from an earlier session must not help.
    const { req, guarded, wasHandlerRan } = guardedRequest(`${DEMO_COOKIE_NAME}=stale-token`);
    disableDemo();
    const res = await guarded(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
    expect(wasHandlerRan()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("no secrets exposed through demo surfaces", () => {
  const secrets = {
    BREVO_API_KEY: "xkeysib-brevo_secret_key_123",
    BETTER_AUTH_SECRET: "better_auth_secret_value_abc",
    DATABASE_URL: "postgresql://user:pass@host/db",
  };

  beforeEach(() => {
    for (const [k, v] of Object.entries(secrets)) vi.stubEnv(k, v);
  });

  function assertNoSecrets(label: string, text: string) {
    for (const [k, v] of Object.entries(secrets)) {
      expect(text, `${label} leaked ${k}`).not.toContain(v);
    }
  }

  it("enter response body and cookie carry no secrets", async () => {
    enableDemo();
    const res = await demoEnter();
    assertNoSecrets("enter body", await res.text());
    for (const c of setCalls) assertNoSecrets(`cookie ${c.name}`, c.value);
  });

  it("fixture payloads and dashboard aggregates carry no secrets", async () => {
    seedDemoCookie();
    const res = await demoLeadsGet(new NextRequest("http://localhost/api/demo/leads"));
    assertNoSecrets("demo leads payload", await res.text());
    assertNoSecrets("demo dashboard", JSON.stringify(getDemoDashboard()));
    assertNoSecrets("demo fixtures", JSON.stringify(DEMO_LEADS));
  });
});
