import { z } from "zod";

import { ToolInputError, type ToolDefinition } from "../agent/tools.ts";
import {
  continueOnboarding,
  OnboardingInputError,
  previewOnboarding,
} from "../services/onboarding-service.ts";
import { jsonSchema, parseWith } from "./helpers.ts";

const continueInput = z.object({
  answer: z
    .string()
    .optional()
    .describe(
      "The owner's reply to the current setup question. Omit to hear the question again.",
    ),
  skip: z
    .boolean()
    .optional()
    .describe("True when they want to skip this step."),
  fieldKeys: z
    .array(z.string())
    .optional()
    .describe(
      "For the data-to-track step: template keys such as home_address, " +
        "date_of_birth, preferred_shift, certifications, job_role, work_location.",
    ),
});

export const continueOnboardingTool: ToolDefinition<
  z.infer<typeof continueInput>
> = {
  name: "continue_onboarding",
  description:
    "Start or continue account setup: business details, what to track, " +
    "pay, schedule and leave policy. Call this whenever the owner is " +
    "answering a setup question, or says they want to set up the account.",
  inputSchema: jsonSchema(continueInput),
  mutates: true,
  parse: (input) => parseWith(continueInput, input),

  async summarize(input, context) {
    try {
      const preview = await previewOnboarding({
        accountId: context.accountId,
        ...(input.answer ? { answer: input.answer } : {}),
        ...(input.skip ? { skip: true } : {}),
        ...(input.fieldKeys ? { fieldKeys: input.fieldKeys } : {}),
      });
      if (!preview.willChange) {
        return { willChange: false, message: preview.message };
      }
      return { willChange: true, summary: preview.summary ?? preview.message };
    } catch (error) {
      if (error instanceof OnboardingInputError) {
        return { willChange: false, message: error.message };
      }
      throw error;
    }
  },

  async execute(input, context) {
    try {
      const result = await continueOnboarding({
        accountId: context.accountId,
        ...(input.answer ? { answer: input.answer } : {}),
        ...(input.skip ? { skip: true } : {}),
        ...(input.fieldKeys ? { fieldKeys: input.fieldKeys } : {}),
      });
      return { message: result.message, data: result };
    } catch (error) {
      if (error instanceof OnboardingInputError) {
        throw new ToolInputError(error.message);
      }
      throw error;
    }
  },
};
