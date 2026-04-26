import type { Room } from "../models/types";
import { DiscussionService } from "./discussion-service";
import { PromptService } from "./prompt-service";
import { DiscussionPromptBuilder } from "./discussion-prompt-builder";
import { LlmService } from "./llm-service";

const FALLBACK_HINT = "You may begin by clearly stating your main opinion.";

export interface HintCallbacks {
  onChunk: (chunk: string, reasoningChunk?: string) => void;
  onDone: (fullText: string, reasoningContent?: string) => void;
}

/**
 * Generate a real AI hint for the given room member (streaming).
 *
 * Validates via discussion-service canRequestHint (only the assigned
 * current speaker who has not yet started speaking may request a hint).
 * Assembles the hint prompt with shared discussion history, then calls
 * the LLM with HINT_MODEL in streaming mode.
 *
 * Delivers chunks via `callbacks.onChunk` and the final result via
 * `callbacks.onDone`. On validation failure or LLM error the fallback
 * text is still delivered through the callbacks so the caller only has
 * to handle the streaming interface.
 */
export async function generateHint(
  room: Room,
  memberId: string,
  callbacks: HintCallbacks,
): Promise<void> {
  // Validate via discussion-service
  const canHint = DiscussionService.canRequestHint(room.roomId, memberId);
  if (!canHint.success) {
    callbacks.onChunk(FALLBACK_HINT);
    callbacks.onDone(FALLBACK_HINT);
    return;
  }

  // Find the requesting member
  const member = room.members.find((m) => m.memberId === memberId);
  if (!member) {
    callbacks.onChunk(FALLBACK_HINT);
    callbacks.onDone(FALLBACK_HINT);
    return;
  }

  // Assemble prompt
  const systemPrompt = PromptService.getHintPrompt();
  const messages = room.discussion?.messages ?? [];
  const userPrompt = DiscussionPromptBuilder.buildHintUserPrompt({
    messages,
    userDisplayName: member.displayName,
  });

  // Call LLM (streaming)
  await LlmService.streamChatCompletion(
    LlmService.getModelForCallType("hint"),
    systemPrompt,
    userPrompt,
    {
      onChunk: callbacks.onChunk,
      onDone: (fullText, _wasFallback, reasoningContent) => {
        callbacks.onDone(fullText, reasoningContent);
      },
    },
    FALLBACK_HINT,
  );
}

export const HintService = {
  generateHint,
};

export default HintService;
