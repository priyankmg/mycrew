import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// Next only reads .env files from the app directory, but this monorepo keeps
// a single .env at the root. Load it here so local dev and local builds see
// the same variables. Hosted deploys inject their own environment, and dotenv
// does not override values that are already set.
loadEnv({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../.env",
  ),
});

const config: NextConfig = {
  // The workspace packages ship TypeScript source rather than a build step,
  // which keeps the monorepo simple and means edits are picked up instantly
  // in dev. Next compiles them as part of the app.
  transpilePackages: [
    "@mycrew/core",
    "@mycrew/db",
    "@mycrew/llm",
    "@mycrew/channels",
  ],

  // Prisma and pg load native/Node-only code and must not be bundled.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],

  typescript: {
    // Type errors should fail CI via `npm run typecheck`, not silently at
    // build time in a way that's easy to miss.
    ignoreBuildErrors: false,
  },
};

export default config;
