import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer loads .env automatically. This monorepo keeps a single
// .env at the root rather than one per package, so load it explicitly and
// resolve the path relative to this file — Prisma CLI commands get run from
// several different working directories.
const packageDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(packageDir, "../../.env") });

/**
 * This config is used by the Prisma CLI only — migrate, studio, db pull.
 * Application queries do not read it; they connect through the driver adapter
 * in src/client.ts.
 *
 * That split is exactly what Neon needs, and it lets each side use the right
 * endpoint:
 *
 *   CLI (here)          -> direct endpoint. Migrations issue DDL and take
 *                          advisory locks, neither of which survives a
 *                          transaction pooler.
 *   Runtime (client.ts) -> pooled endpoint, so serverless invocations don't
 *                          exhaust Postgres connection slots.
 *
 * Both variable names match what the Neon integration for Vercel injects, so
 * nothing needs remapping on deploy.
 */
const migrationUrl =
  process.env["DATABASE_URL_UNPOOLED"] ?? process.env["DATABASE_URL"];

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },

  ...(migrationUrl ? { datasource: { url: migrationUrl } } : {}),
});
