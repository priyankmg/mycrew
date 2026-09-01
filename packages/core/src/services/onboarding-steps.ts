import { FIELD_TEMPLATES } from "../schema/system-fields.ts";
import type { FieldSpec } from "../schema/types.ts";

export const ONBOARDING_STEPS = [
  "BUSINESS_BASICS",
  "TEAM_SIZE",
  "DATA_TO_TRACK",
  "PAY_SETUP",
  "SCHEDULE_SETUP",
  "POLICY_SURVEY",
  "ROSTER_IMPORT",
  "COMPLETE",
] as const;

export type OnboardingStepName = (typeof ONBOARDING_STEPS)[number];

/** Templates the survey may add. Restricted fields never enter chat. */
export function onboardableTemplates(): readonly FieldSpec[] {
  return FIELD_TEMPLATES.filter((spec) => spec.sensitivity !== "RESTRICTED");
}

export function questionFor(step: OnboardingStepName): string {
  switch (step) {
    case "BUSINESS_BASICS":
      return (
        "What's the business called, and where do you operate? " +
        "A city or timezone is enough."
      );
    case "TEAM_SIZE":
      return "How many people are on the team, including you?";
    case "DATA_TO_TRACK":
      return (
        "Besides pay, what should I keep on file? I can track " +
        `${onboardableTemplates()
          .map((spec) => spec.label.toLowerCase())
          .join(", ")}. ` +
        "Say which ones, 'all', or 'skip'."
      );
    case "PAY_SETUP":
      return (
        "Are most people paid hourly, daily, or per job? " +
        "And do you pay weekly or every two weeks?"
      );
    case "SCHEDULE_SETUP":
      return (
        "What does a typical shift look like — start and finish, " +
        "for example 9 to 5?"
      );
    case "POLICY_SURVEY":
      return (
        "For time off: do you offer paid sick days, and how many a year? " +
        "Unpaid time off as well?"
      );
    case "ROSTER_IMPORT":
      return (
        "If you have a staff list, you can add people in chat whenever " +
        "you're ready — say skip unless you want to do that now."
      );
    case "COMPLETE":
      return (
        "You're set up. You can add people, clock hours, and handle " +
        "leave from chat."
      );
  }
}

export function nextStep(step: OnboardingStepName): OnboardingStepName {
  const index = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.min(index + 1, ONBOARDING_STEPS.length - 1)]!;
}

export interface ParsedTrackChoice {
  skip: boolean;
  keys: string[];
}

export function parseDataToTrack(answer: string): ParsedTrackChoice {
  const text = answer.trim().toLowerCase();
  if (text === "" || /^(skip|none|nothing|later|no|n\/a)$/i.test(text)) {
    return { skip: true, keys: [] };
  }

  const templates = onboardableTemplates();
  if (/\b(all|everything|yes|yep|sure)\b/i.test(text) && !/\bbut\b/.test(text)) {
    return { skip: false, keys: templates.map((spec) => spec.key) };
  }

  const keys: string[] = [];
  for (const spec of templates) {
    const label = spec.label.toLowerCase();
    const keyAsWords = spec.key.replace(/_/g, " ");
    if (text.includes(label) || text.includes(keyAsWords) || text.includes(spec.key)) {
      keys.push(spec.key);
    }
  }

  // "role" alone should pick job_role, not certifications.
  if (/\broles?\b/.test(text) && !keys.includes("job_role")) {
    keys.unshift("job_role");
  }

  if (keys.length === 0) return { skip: true, keys: [] };
  return { skip: false, keys: [...new Set(keys)] };
}

export function parseTeamSize(answer: string): number | undefined {
  const match = answer.match(/\b(\d{1,3})\b/);
  if (!match) return undefined;
  const count = Number(match[1]);
  return count > 0 ? count : undefined;
}

export function parseSickDays(answer: string): number | undefined {
  const match = answer.match(/\b(\d{1,2})\b/);
  if (!match) return undefined;
  return Number(match[1]);
}

export function wantsUnpaidLeave(answer: string): boolean {
  if (/\bno unpaid\b|\bwithout unpaid\b/i.test(answer)) return false;
  return /\bunpaid\b|\byes\b|\byeah\b|\bboth\b/i.test(answer);
}

export function isSkip(answer: string): boolean {
  return /^(skip|none|nothing|later|n\/a|pass)$/i.test(answer.trim());
}

export function describeFields(keys: readonly string[]): string {
  const labels = keys.map((key) => {
    const spec = onboardableTemplates().find((item) => item.key === key);
    return spec?.label.toLowerCase() ?? key;
  });
  if (labels.length === 0) return "nothing extra";
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
