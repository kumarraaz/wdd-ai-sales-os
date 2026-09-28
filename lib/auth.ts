import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "./db";
import { sendEmail, appUrl } from "./email";

function slugify(input: string): string {
  const base =
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "workspace";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your WDD AI Sales OS password",
        html: `<p>Click the link below to reset your password. It expires in 1 hour.</p><p><a href="${url}">${url}</a></p>`,
        text: `Reset your password: ${url}`,
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify your WDD AI Sales OS account",
        html: `<p>Welcome! Verify your email to activate your workspace:</p><p><a href="${url}">${url}</a></p>`,
        text: `Verify your email: ${url}`,
      });
    },
  },

  // Google OAuth only when credentials are configured — the button is hidden otherwise, never faked.
  ...(googleClientId && googleClientSecret
    ? {
        socialProviders: {
          google: { clientId: googleClientId, clientSecret: googleClientSecret },
        },
      }
    : {}),

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },

  advanced: {
    cookiePrefix: "wdd",
    useSecureCookies: process.env.NODE_ENV === "production",
  },

  // Base URL for callbacks, email links and OAuth redirects. Derived from
  // NEXT_PUBLIC_APP_URL (set to the production domain on Vercel); without it
  // better-auth falls back to inferring the host from each request.
  baseURL: appUrl(),

  // Origin allowlist for /api/auth/* (CSRF protection). better-auth rejects
  // non-GET auth requests whose Origin/Referer is missing or not listed here —
  // keep this in sync with NEXT_PUBLIC_APP_URL. Never disable globally.
  trustedOrigins: [appUrl()],

  databaseHooks: {
    user: {
      create: {
        // Every signup gets a personal organization + OWNER membership + FREE subscription.
        after: async (user) => {
          try {
            const existing = await db.membership.findFirst({ where: { userId: user.id } });
            if (existing) return;
            const orgName = user.name ? `${user.name}'s Workspace` : "My Workspace";
            const plan = await db.plan.findUnique({ where: { tier: "FREE" } });
            await db.$transaction(async (tx) => {
              const org = await tx.organization.create({
                data: { name: orgName, slug: slugify(user.email ?? orgName) },
              });
              await tx.membership.create({
                data: { userId: user.id, organizationId: org.id, role: "OWNER" },
              });
              if (plan) {
                await tx.subscription.create({
                  data: { organizationId: org.id, planId: plan.id, status: "TRIALING" },
                });
              }
            });
          } catch (err) {
            // Never fail signup because provisioning hiccuped — log loudly.
            console.error("[auth] workspace provisioning failed for user", user.id, err);
          }
        },
      },
    },
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
  },
});

export type Session = typeof auth.$Infer.Session;
