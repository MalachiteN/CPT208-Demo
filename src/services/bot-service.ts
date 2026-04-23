import type { Room, Member, BotStreamContext } from "../models/types";
import { PromptService } from "./prompt-service";
import { DiscussionPromptBuilder } from "./discussion-prompt-builder";
import { LlmService } from "./llm-service";

// ---------------------------------------------------------------------------
// Active bot stream tracking
// ---------------------------------------------------------------------------

const activeStreams = new Map<string, BotStreamContext>();

function streamKey(roomId: string, memberId: string): string {
  return `${roomId}:${memberId}`;
}

// ---------------------------------------------------------------------------
// Public API — matches the interface expected by discuss-ws
// ---------------------------------------------------------------------------

/**
 * Start a real LLM streaming bot turn.
 *
 * Assembles the roleplay prompt (system + shared history + bot persona),
 * calls the LLM with streaming, forwards each chunk via onChunk,
 * and calls onDone with the full accumulated text when the stream ends
 * or the LLM call fails.
 *
 * The bot stream is tracked by roomId+memberId with an AbortController
 * so it can be cancelled on human interrupt.
 */
export function startBotTurn(
  room: Room,
  botMember: Member,
  onChunk: (chunk: string) => void,
  onDone: (fullText: string) => void,
): void {
  const key = streamKey(room.roomId, botMember.memberId);

  // Abort any existing stream for this bot in this room
  const existing = activeStreams.get(key);
  if (existing) {
    existing.abortController.abort();
    activeStreams.delete(key);
  }

  const abortController = new AbortController();
  const context: BotStreamContext = {
    roomId: room.roomId,
    memberId: botMember.memberId,
    abortController,
    isStreaming: true,
    accumulatedText: "",
  };
  activeStreams.set(key, context);

  // Assemble prompt
  const systemPrompt = PromptService.getRoleplayPrompt();
  const messages = room.discussion?.messages ?? [];
  const botPersona = botMember.botProfile?.persona ?? "";
  const userPrompt = DiscussionPromptBuilder.buildRoleplayUserPrompt({
    messages,
    botDisplayName: botMember.displayName,
    botPersona,
  });

  console.log(`[bot-service] Bot准备发言并开始流式生成: roomId=${room.roomId}, botMemberId=${botMember.memberId}, botName=${botMember.displayName}`);

  // Fire-and-forget async stream — onDone is called inside the callbacks
  LlmService.streamRoleplayCompletion(
    systemPrompt,
    userPrompt,
    {
      onChunk: (chunk: string) => {
        context.accumulatedText += chunk;
        onChunk(chunk);
      },
      onDone: (fullText: string, _wasFallback: boolean) => {
        context.isStreaming = false;
        activeStreams.delete(key);
        onDone(fullText);
      },
    },
    abortController.signal,
  ).catch(() => {
    // Always clean up activeStreams regardless of abort status.
    context.isStreaming = false;
    activeStreams.delete(key);
  });
}

/**
 * Abort an active bot stream for the given room and member.
 *
 * After calling this, the partial accumulated text is available
 * from getAccumulatedText() for creating an interrupted message.
 */
export function interruptBot(roomId: string, memberId: string): void {
  const key = streamKey(roomId, memberId);
  const context = activeStreams.get(key);
  if (context) {
    context.abortController.abort();
    context.isStreaming = false;
    activeStreams.delete(key);
  }
}

/**
 * Get the accumulated text from a bot stream.
 *
 * This is useful after interruptBot() to retrieve the partial text
 * that was generated before the abort, so it can be used to create
 * an interrupted bot message rather than losing the text entirely.
 *
 * Returns the accumulated text from the stream context if still available,
 * or a fallback string if no context exists (stream already cleaned up).
 */
export function getAccumulatedText(roomId: string, memberId: string): string {
  const key = streamKey(roomId, memberId);
  const context = activeStreams.get(key);
  return context?.accumulatedText ?? "";
}

export function isBotStreaming(roomId: string, memberId: string): boolean {
  const key = streamKey(roomId, memberId);
  const ctx = activeStreams.get(key);
  return ctx?.isStreaming ?? false;
}

/**
 * Abort all active bot streams for a given room.
 *
 * Should be called when discussion ends to prevent orphaned LLM requests
 * from continuing after the room transitions to summary phase.
 */
export function stopAllStreamsForRoom(roomId: string): void {
  const prefix = `${roomId}:`;
  for (const [key, context] of activeStreams) {
    if (key.startsWith(prefix)) {
      context.abortController.abort();
      context.isStreaming = false;
      activeStreams.delete(key);
    }
  }
}

export const BotService = {
  startBotTurn,
  interruptBot,
  getAccumulatedText,
  isBotStreaming,
  stopAllStreamsForRoom,
};

export default BotService;
