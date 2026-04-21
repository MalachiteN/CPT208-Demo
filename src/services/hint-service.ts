import type { Room } from "../models/types";
import { DiscussionService } from "./discussion-service";
import { PromptService } from "./prompt-service";
import { DiscussionPromptBuilder } from "./discussion-prompt-builder";
import { LlmService } from "./llm-service";

const FALLBACK_HINT = "You may begin by clearly stating your main opinion.";

/**
 * Generate a real AI hint for the given room member.
 *
 * Validates via discussion-service canRequestHint (only the assigned
 * current speaker who has not yet started speaking may request a hint).
 * Assembles the hint prompt with shared discussion history, then calls
 * the LLM with HINT_MODEL in non-streaming mode.
 *
 * Returns the hint text, or a fallback string on validation failure or
 * LLM error.
 */
export async function generateHint(room: Room, memberId: string): Promise<string> {
  // Validate via discussion-service
  const canHint = DiscussionService.canRequestHint(room.roomId, memberId);
  if (!canHint.success) {
    return FALLBACK_HINT;
  }

  // Find the requesting member
  const member = room.members.find((m) => m.memberId === memberId);
  if (!member) {
    return FALLBACK_HINT;
  }

  // Assemble prompt
  const systemPrompt = PromptService.getHintPrompt();
  const messages = room.discussion?.messages ?? [];
  const userPrompt = DiscussionPromptBuilder.buildHintUserPrompt({
    messages,
    userDisplayName: member.displayName,
  });

  // Call LLM (non-streaming)
  const result = await LlmService.completeHintCompletion(systemPrompt, userPrompt);
  return result.text;
}

export const HintService = {
  generateHint,
};

export default HintService;
