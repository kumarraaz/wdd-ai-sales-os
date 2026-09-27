import { defineConfig } from "prisma/config";

// Prisma 7: datasource connection for migrations lives here (not in schema.prisma).
// validate/generate don't connect, so tolerate a missing DATABASE_URL here;
// migrate/db push will fail with a clear connection error instead.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://placeholder:5432/placeholder",
  },
});
