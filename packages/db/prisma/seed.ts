/**
 * Demo data for local development.
 *
 * Idempotent: every write is an upsert against a fixed id, so running it
 * repeatedly (or after a migration) converges rather than piling up
 * duplicates.
 *
 * This imports @mycrew/core so the demo account is built the same way a real
 * one is — reusing `seedSystemFields` and `addField` rather than restating the
 * starting schema, which would drift. The dependency direction is only
 * acceptable because this is a standalone script that core never imports.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  addField,
  formatDateInZone,
  instantInZone,
  seedSystemFields,
  toFieldKey,
} from "@mycrew/core";
import { config as loadEnv } from "dotenv";

import { prisma } from "../src/client.ts";

// This script runs as `tsx prisma/seed.ts`, which does not load
// prisma.config.ts, so nothing has read the root .env yet — unlike Prisma CLI
// commands, where the config does it. Resolve the path from this file rather
// than the cwd, since npm invokes the script from several directories.
//
// Safe to do after the client import: the client reads DATABASE_URL on first
// use, not on import.
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(scriptDir, "../../../.env") });

const ACCOUNT_ID = "acc_demo_rosies";
const OWNER_USER_ID = "usr_demo_owner";

const STAFF = [
  {
    employeeId: "emp_demo_sam",
    userId: "usr_demo_sam",
    fullName: "Sam Ortiz",
    phone: "+15550000002",
    jobTitle: "Barista",
    payRate: 18.5,
  },
  {
    employeeId: "emp_demo_dana",
    userId: "usr_demo_dana",
    fullName: "Dana Vega",
    phone: "+15550000003",
    jobTitle: "Kitchen assistant",
    payRate: 17,
  },
  {
    employeeId: "emp_demo_shlok",
    userId: "usr_demo_shlok",
    fullName: "Shlok Gupta",
    phone: "+15550000004",
    jobTitle: null,
    payRate: null,
  },
] as const;

async function main(): Promise<void> {
  const account = await prisma.account.upsert({
    where: { id: ACCOUNT_ID },
    create: {
      id: ACCOUNT_ID,
      businessName: "Rosie's Cafe",
      legalName: "Rosie's Cafe LLC",
      timezone: "America/Los_Angeles",
      countryCode: "US",
      regionCode: "CA",
      industry: "Food service",
    },
    update: {},
  });

  await prisma.user.upsert({
    where: { id: OWNER_USER_ID },
    create: {
      id: OWNER_USER_ID,
      accountId: account.id,
      role: "OWNER",
      displayName: "Priya Mohan",
      phoneE164: "+15550000001",
    },
    update: {},
  });

  const seeded = await seedSystemFields(account.id);

  // A field no product designer chose in advance — the case story 1.8 exists
  // for. Added at runtime, with no migration.
  //
  // The key is derived from the label by `toFieldKey`, so it is computed here
  // rather than written out: hard-coding it once drifted from the label and
  // made this check never match, which silently created a duplicate field on
  // every reseed.
  const customFieldLabel = "Food handler card expiry";
  const existingCustom = await prisma.fieldDefinition.findFirst({
    where: { accountId: account.id, key: toFieldKey(customFieldLabel) },
    select: { id: true },
  });
  if (!existingCustom) {
    await addField({
      accountId: account.id,
      entity: "EMPLOYEE",
      label: customFieldLabel,
      dataType: "DATE",
      // Staff can ask to update it; the owner confirms, since it is a
      // compliance record.
      editPolicy: "EMPLOYEE_REQUEST",
      visibility: "EMPLOYEE_VISIBLE",
      source: "ONBOARDING_SURVEY",
    });
  }

  for (const person of STAFF) {
    await prisma.employee.upsert({
      where: { id: person.employeeId },
      create: {
        id: person.employeeId,
        accountId: account.id,
        fullName: person.fullName,
        phoneE164: person.phone,
        jobTitle: person.jobTitle,
        status: "ACTIVE",
        employmentType: "HOURLY",
        startDate:
          person.payRate === null ? new Date() : new Date("2025-06-01"),
        attributes:
          person.payRate === null
            ? { pay_basis: "hourly" }
            : {
                pay_rate: person.payRate,
                pay_basis: "hourly",
              },
      },
      update: {},
    });

    await prisma.user.upsert({
      where: { id: person.userId },
      create: {
        id: person.userId,
        accountId: account.id,
        role: "EMPLOYEE",
        displayName: person.fullName,
        phoneE164: person.phone,
        employeeId: person.employeeId,
      },
      update: {},
    });
  }

  // Today's shifts, refreshed on every seed so clock-in can detect lateness
  // against a real schedule rather than a stale date.
  const timezone = account.timezone;
  const today = formatDateInZone(new Date(), timezone);
  const shifts = [
    {
      id: "sft_demo_sam_today",
      employeeId: "emp_demo_sam",
      start: "09:00",
      end: "17:00",
      role: "Barista",
    },
    {
      id: "sft_demo_dana_today",
      employeeId: "emp_demo_dana",
      start: "10:00",
      end: "18:00",
      role: "Kitchen",
    },
  ] as const;

  for (const shift of shifts) {
    await prisma.shift.upsert({
      where: { id: shift.id },
      create: {
        id: shift.id,
        accountId: account.id,
        employeeId: shift.employeeId,
        startAt: instantInZone(today, shift.start, timezone),
        endAt: instantInZone(today, shift.end, timezone),
        role: shift.role,
      },
      update: {
        employeeId: shift.employeeId,
        startAt: instantInZone(today, shift.start, timezone),
        endAt: instantInZone(today, shift.end, timezone),
        role: shift.role,
      },
    });
  }

  // A minimal leave policy, of the kind the onboarding survey generates.
  const existingPolicy = await prisma.policy.findFirst({
    where: { accountId: account.id, kind: "LEAVE" },
    select: { id: true },
  });
  if (!existingPolicy) {
    await prisma.policy.create({
      data: {
        accountId: account.id,
        kind: "LEAVE",
        name: "Standard leave",
        config: {
          types: [
            { key: "sick", label: "Sick leave", paid: true, annualDays: 5 },
            { key: "unpaid", label: "Unpaid time off", paid: false },
          ],
          noticeDays: 2,
        },
        source: "ONBOARDING_SURVEY",
      },
    });
  }

  console.log(
    [
      "Seeded demo account:",
      `  account   ${account.businessName} (${account.id})`,
      `  owner     Priya Mohan`,
      `  staff     ${STAFF.map((person) => person.fullName).join(", ")}`,
      `  shifts    Sam 09:00–17:00, Dana 10:00–18:00 (${today})`,
      `  fields    ${seeded} system + 1 custom`,
      "",
      "Start the app with `npm run dev` and open http://localhost:3000",
    ].join("\n"),
  );
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
