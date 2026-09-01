import { prisma, type OnboardingStep } from "@mycrew/db";

import type { FieldSpec } from "../schema/types.ts";
import {
  describeFields,
  isSkip,
  nextStep,
  onboardableTemplates,
  parseDataToTrack,
  parseSickDays,
  parseTeamSize,
  questionFor,
  wantsUnpaidLeave,
  type OnboardingStepName,
} from "./onboarding-steps.ts";

export class OnboardingInputError extends Error {
  override readonly name = "OnboardingInputError";
}

export interface ContinueOnboardingInput {
  accountId: string;
  answer?: string;
  skip?: boolean;
  /** Model-extracted template keys for the data-to-track step. */
  fieldKeys?: string[];
}

export interface ContinueOnboardingResult {
  step: OnboardingStepName;
  completed: boolean;
  message: string;
  createdFields: string[];
}

type Answers = Record<string, unknown>;

export async function previewOnboarding(
  input: ContinueOnboardingInput,
): Promise<{ willChange: boolean; message: string; summary?: string }> {
  const session = await loadSession(input.accountId);

  if (!session) {
    return {
      willChange: true,
      message: "",
      summary: "I'll start the setup questions for this account.",
    };
  }

  if (session.currentStep === "COMPLETE") {
    return {
      willChange: false,
      message: questionFor("COMPLETE"),
    };
  }

  const answer = input.answer?.trim();
  if (!answer && !input.skip) {
    return {
      willChange: false,
      message: questionFor(session.currentStep as OnboardingStepName),
    };
  }

  if (session.currentStep === "DATA_TO_TRACK") {
    const choice = resolveTrackChoice(input);
    if (!choice.skip && choice.keys.length > 0) {
      return {
        willChange: true,
        message: "",
        summary: `I'll start tracking ${describeFields(choice.keys)}.`,
      };
    }
  }

  if (session.currentStep === "PAY_SETUP" && !input.skip && !isSkip(answer ?? "")) {
    return {
      willChange: true,
      message: "",
      summary: "I'll save a pay cycle from what you said.",
    };
  }

  if (session.currentStep === "POLICY_SURVEY" && !input.skip && !isSkip(answer ?? "")) {
    return {
      willChange: true,
      message: "",
      summary: "I'll save a leave policy from what you said.",
    };
  }

  return {
    willChange: true,
    message: "",
    summary: "I'll save that and ask the next thing.",
  };
}

export async function continueOnboarding(
  input: ContinueOnboardingInput,
): Promise<ContinueOnboardingResult> {
  let session = await loadSession(input.accountId);

  if (!session) {
    session = await prisma.onboardingSession.create({
      data: { accountId: input.accountId, currentStep: "BUSINESS_BASICS" },
      select: sessionSelect,
    });
    return {
      step: "BUSINESS_BASICS",
      completed: false,
      createdFields: [],
      message: questionFor("BUSINESS_BASICS"),
    };
  }

  if (session.currentStep === "COMPLETE") {
    return {
      step: "COMPLETE",
      completed: true,
      createdFields: [],
      message: questionFor("COMPLETE"),
    };
  }

  const answer = input.answer?.trim();
  if (!answer && !input.skip) {
    return {
      step: session.currentStep as OnboardingStepName,
      completed: false,
      createdFields: [],
      message: questionFor(session.currentStep as OnboardingStepName),
    };
  }

  const applied = await applyCurrentStep(session, input);
  const following = nextStep(session.currentStep as OnboardingStepName);
  const done = following === "COMPLETE";

  await prisma.onboardingSession.update({
    where: { id: session.id },
    data: {
      currentStep: following as OnboardingStep,
      answers: applied.answers as never,
      skipped: applied.skipped as never,
      ...(done ? { completedAt: new Date() } : {}),
    },
  });

  const nextQuestion = questionFor(following);
  const prefix = applied.note ? `${applied.note} ` : "";

  return {
    step: following,
    completed: done,
    createdFields: applied.createdFields,
    message: `${prefix}${nextQuestion}`,
  };
}

export async function activeOnboarding(
  accountId: string,
): Promise<{ step: OnboardingStepName; question: string } | null> {
  const session = await loadSession(accountId);
  if (!session || session.currentStep === "COMPLETE") return null;
  const step = session.currentStep as OnboardingStepName;
  return { step, question: questionFor(step) };
}

const sessionSelect = {
  id: true,
  currentStep: true,
  answers: true,
  skipped: true,
} as const;

async function loadSession(accountId: string) {
  return prisma.onboardingSession.findFirst({
    where: { accountId },
    orderBy: { createdAt: "desc" },
    select: sessionSelect,
  });
}

async function applyCurrentStep(
  session: {
    currentStep: OnboardingStep;
    answers: unknown;
    skipped: unknown;
  },
  input: ContinueOnboardingInput,
): Promise<{
  answers: Answers;
  skipped: string[];
  createdFields: string[];
  note: string;
}> {
  const answers = asAnswers(session.answers);
  const skipped = asStringArray(session.skipped);
  const step = session.currentStep as OnboardingStepName;
  const raw = input.answer?.trim() ?? "";
  const skip = Boolean(input.skip) || isSkip(raw);
  let createdFields: string[] = [];

  if (skip) {
    skipped.push(step);
    const note =
      step === "ROSTER_IMPORT"
        ? "You can add people by name in chat whenever you're ready."
        : "";
    return { answers, skipped, createdFields, note };
  }

  let note = "";

  switch (step) {
    case "BUSINESS_BASICS":
      answers[step] = { raw };
      await maybeUpdateAccount(input.accountId, raw);
      break;
    case "TEAM_SIZE":
      answers[step] = { raw, count: parseTeamSize(raw) };
      break;
    case "DATA_TO_TRACK": {
      const choice = resolveTrackChoice(input);
      answers[step] = { raw, keys: choice.keys };
      if (!choice.skip && choice.keys.length > 0) {
        createdFields = await addTemplateFields(input.accountId, choice.keys);
        note =
          createdFields.length > 0
            ? `I've added ${describeFields(createdFields)} to what we track.`
            : "Those were already on file.";
      }
      break;
    }
    case "PAY_SETUP":
      answers[step] = { raw };
      await upsertPolicy(input.accountId, "PAY_CYCLE", "Pay cycle", {
        cadence: /\bbi-?week|fortnight|every two/i.test(raw)
          ? "biweekly"
          : "weekly",
        basis: /\bdaily\b/i.test(raw)
          ? "daily"
          : /\bper job\b|\bby the job\b/i.test(raw)
            ? "per_job"
            : "hourly",
      }, raw);
      break;
    case "SCHEDULE_SETUP":
      answers[step] = { raw };
      break;
    case "POLICY_SURVEY": {
      const sickDays = parseSickDays(raw) ?? 5;
      const unpaid = wantsUnpaidLeave(raw);
      answers[step] = { raw, sickDays, unpaid };
      const types = [
        ...(sickDays
          ? [{ key: "sick", label: "Sick leave", paid: true, annualDays: sickDays }]
          : []),
        ...(unpaid
          ? [{ key: "unpaid", label: "Unpaid time off", paid: false }]
          : []),
      ];
      if (types.length > 0) {
        await upsertPolicy(
          input.accountId,
          "LEAVE",
          "Standard leave",
          { types, noticeDays: 2 },
          raw,
        );
        note = "I've saved that as your leave policy.";
      }
      break;
    }
    case "ROSTER_IMPORT":
      answers[step] = { raw, deferred: true };
      note = "You can add people by name in chat whenever you're ready.";
      break;
    case "COMPLETE":
      break;
  }

  return { answers, skipped, createdFields, note };
}

function resolveTrackChoice(input: ContinueOnboardingInput) {
  if (input.fieldKeys && input.fieldKeys.length > 0) {
    const allowed = new Set(onboardableTemplates().map((spec) => spec.key));
    const keys = input.fieldKeys.filter((key) => allowed.has(key));
    return { skip: keys.length === 0, keys };
  }
  return parseDataToTrack(input.answer ?? "");
}

async function addTemplateFields(
  accountId: string,
  keys: readonly string[],
): Promise<string[]> {
  const templates = onboardableTemplates();
  const existing = await prisma.fieldDefinition.findMany({
    where: { accountId },
    select: { key: true, entity: true },
  });
  const taken = new Set(existing.map((row) => `${row.entity}:${row.key}`));
  const created: string[] = [];

  for (const key of keys) {
    const spec = templates.find((item) => item.key === key);
    if (!spec) continue;
    if (taken.has(`${spec.entity}:${spec.key}`)) continue;
    await persistTemplate(accountId, spec);
    taken.add(`${spec.entity}:${spec.key}`);
    created.push(spec.key);
  }

  return created;
}

async function persistTemplate(accountId: string, spec: FieldSpec): Promise<void> {
  const maxOrder = await prisma.fieldDefinition.aggregate({
    where: { accountId, entity: spec.entity },
    _max: { displayOrder: true },
  });

  await prisma.fieldDefinition.create({
    data: {
      accountId,
      entity: spec.entity,
      key: spec.key,
      label: spec.label,
      description: spec.description ?? null,
      dataType: spec.dataType,
      isRequired: spec.isRequired,
      isCore: false,
      editPolicy: spec.editPolicy,
      visibility: spec.visibility,
      sensitivity: spec.sensitivity ?? "CONFIDENTIAL",
      options: (spec.options ?? null) as never,
      validation: (spec.validation ?? null) as never,
      defaultValue: (spec.defaultValue ?? null) as never,
      source: "ONBOARDING_SURVEY",
      displayOrder: (maxOrder._max.displayOrder ?? 0) + 1,
    },
  });
}

async function upsertPolicy(
  accountId: string,
  kind: "LEAVE" | "PAY_CYCLE",
  name: string,
  config: unknown,
  transcript: string,
): Promise<void> {
  const existing = await prisma.policy.findFirst({
    where: { accountId, kind, isActive: true },
    select: { id: true, version: true },
  });
  if (existing) {
    await prisma.policy.update({
      where: { id: existing.id },
      data: { isActive: false, effectiveTo: new Date() },
    });
  }
  await prisma.policy.create({
    data: {
      accountId,
      kind,
      name,
      config: config as never,
      source: "ONBOARDING_SURVEY",
      sourceTranscript: transcript,
      version: (existing?.version ?? 0) + 1,
    },
  });
}

async function maybeUpdateAccount(accountId: string, raw: string): Promise<void> {
  const named = raw.match(/(?:called|name(?:d)? is)\s+([^,.]+)/i);
  const industry = raw.match(
    /\b(cafe|restaurant|landscap(?:ing|er)|cleaning|hvac|plumb(?:ing|er)|catering|retail|construction)\b/i,
  );
  const data: { businessName?: string; industry?: string } = {};
  if (named) data.businessName = named[1]!.trim();
  if (industry) data.industry = industry[1]!;
  if (Object.keys(data).length === 0) return;
  await prisma.account.update({
    where: { id: accountId },
    data,
  });
}

function asAnswers(value: unknown): Answers {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Answers) }
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}
