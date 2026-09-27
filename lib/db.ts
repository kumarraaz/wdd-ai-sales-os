import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7: the client needs an explicit adapter for direct DB connections.
// The adapter is lazy — it only connects on first query, so importing this
// module (e.g. during `next build`) without DATABASE_URL set is safe.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

// Prisma singleton — never create ad-hoc PrismaClient instances elsewhere.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
