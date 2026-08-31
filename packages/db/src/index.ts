export { prisma, type PrismaClient } from "./client.ts";

// Re-exported so the rest of the monorepo never imports from the generated
// client directory directly. That keeps the generator's output path an
// implementation detail of this package.
export * from "./generated/client/client.ts";
