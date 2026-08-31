import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client/client.ts";

/**
 * Prisma 7 has no query engine binary; it talks to Postgres through a driver
 * adapter. We use the plain `pg` adapter over TCP against Neon's pooled
 * endpoint, which is the right pairing for request handlers that come and go.
 */
function createPrismaClient(): PrismaClient {
  const connectionString = process.env["DATABASE_URL"];

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill in your " +
        "Neon connection strings (see docs/setup.md).",
    );
  }

  const adapter = new PrismaPg({
    connectionString,
    // Neon's pooler multiplexes for us, so each serverless instance only
    // needs a small local pool. A large pool here would hold connections
    // open across invocations for no benefit.
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({
    adapter,
    log:
      process.env["NODE_ENV"] === "development"
        ? ["warn", "error"]
        : ["error"],
  });
}

// Next.js dev mode reloads modules on every edit. Without caching on
// globalThis, each reload would open a new pool and exhaust Postgres
// connection slots within a few minutes of editing.
const globalForPrisma = globalThis as unknown as {
  __mycrewPrisma?: PrismaClient;
};

function getClient(): PrismaClient {
  const existing = globalForPrisma.__mycrewPrisma;
  if (existing) return existing;

  const client = createPrismaClient();
  if (process.env["NODE_ENV"] !== "production") {
    globalForPrisma.__mycrewPrisma = client;
  }
  return client;
}

/**
 * Connects on first use rather than on import.
 *
 * Importing this module must not require a reachable database or a populated
 * environment: Next.js imports every route module while collecting build
 * metadata, and constructing the client eagerly would make a production build
 * fail without credentials. Laziness keeps configuration a runtime concern,
 * where it belongs.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export type { PrismaClient };
