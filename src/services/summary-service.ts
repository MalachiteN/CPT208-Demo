import { Room, SummaryState } from "../models/types";
import { RoomStore } from "../stores/room-store";
import { ServiceResult } from "../models/types";
import { PromptService } from "./prompt-service";
import { DiscussionPromptBuilder } from "./discussion-prompt-builder";
import { LlmService, StreamCallbacks } from "./llm-service";

function computeSummaryState(room: Room): SummaryState {
  const discussion = room.discussion;
  if (!discussion) {
    return {
      fixedRubrics: {
        everyoneSpoke: null,
        hasValidInterruption: false,
        leaderSameAsLastSpeaker: null,
        leaderMemberId: null,
      },
      llmSummaryStatus: "idle",
      llmSummaryText: "",
      llmSummaryCursor: 0,
    };
  }

  // Include both speech and bot_final messages as substantive turns
  const spokenMemberIds = new Set(
    discussion.messages
      .filter((message) => (message.type === "speech" || message.type === "bot_final") && message.speakerMemberId)
      .map((message) => message.speakerMemberId as string)
  );

  const everyoneSpoke = room.members.every((member) => spokenMemberIds.has(member.memberId));
  const leaderSameAsLastSpeaker =
    discussion.leaderMemberId !== null && discussion.lastSpeakerMemberId !== null
      ? discussion.leaderMemberId === discussion.lastSpeakerMemberId
      : null;

  return {
    fixedRubrics: {
      everyoneSpoke,
      hasValidInterruption: discussion.hasInterruptionOccurred,
      leaderSameAsLastSpeaker,
      leaderMemberId: discussion.leaderMemberId,
    },
    llmSummaryStatus: room.summary?.llmSummaryStatus || "idle",
    llmSummaryText: room.summary?.llmSummaryText || "",
    llmSummaryCursor: room.summary?.llmSummaryCursor || 0,
  };
}

export function initializeSummary(roomId: string): ServiceResult<Room> {
  const room = RoomStore.getRoom(roomId);
  if (!room) {
    return { success: false, error: "Room not found" };
  }

  if (room.phase !== "summary") {
    return { success: false, error: "Room is not in summary phase" };
  }

  room.summary = computeSummaryState(room);
  RoomStore.updateRoom(room);

  return { success: true, data: room };
}

export function getFixedRubrics(roomId: string): ServiceResult<SummaryState["fixedRubrics"]> {
  const room = RoomStore.getRoom(roomId);
  if (!room) {
    return { success: false, error: "Room not found" };
  }

  if (room.phase !== "summary") {
    return { success: false, error: "Room is not in summary phase" };
  }

  if (!room.summary) {
    room.summary = computeSummaryState(room);
    RoomStore.updateRoom(room);
  }

  return {
    success: true,
    data: room.summary.fixedRubrics,
  };
}

/**
 * Start the real LLM summary evaluation stream.
 *
 * Uses SUMMARY_MODEL with the summary system prompt and shared discussion
 * history template. Streams chunks via callbacks.onChunk, and calls
 * callbacks.onDone when finished (or on failure with fallback text).
 *
 * Tracks explicit cursor-based progression via llmSummaryCursor.
 * On failure, provides fallback summary text and still emits completion.
 * Prevents duplicate concurrent streams by checking llmSummaryStatus.
 */
export async function startSummaryStream(
  roomId: string,
  callbacks: {
    onChunk: (chunk: string) => void;
    onDone: (fullText: string) => void;
  }
): Promise<void> {
  const room = RoomStore.getRoom(roomId);
  if (!room) {
    callbacks.onDone("[Could not generate evaluation: room not found]");
    return;
  }

  if (room.phase !== "summary") {
    callbacks.onDone("[Could not generate evaluation: not in summary phase]");
    return;
  }

  // Ensure summary state exists
  if (!room.summary) {
    room.summary = computeSummaryState(room);
  }

  // Prevent duplicate concurrent streams
  if (room.summary.llmSummaryStatus === "streaming") {
    console.log(`[summary-service] Stream already active for room ${roomId}, skipping`);
    return;
  }

  if (room.summary.llmSummaryStatus === "done") {
    // Already done — emit the existing text
    callbacks.onDone(room.summary.llmSummaryText);
    return;
  }

  // Mark as streaming
  room.summary.llmSummaryStatus = "streaming";
  room.summary.llmSummaryCursor = 0;
  RoomStore.updateRoom(room);

  // Build prompts
  const systemPrompt = PromptService.getSummaryPrompt();
  const userPrompt = DiscussionPromptBuilder.buildSummaryUserPrompt({
    messages: room.discussion?.messages || [],
  });

  const fallbackText = "[Could not generate evaluation]";

  const streamCallbacks: StreamCallbacks = {
    onChunk: (chunk: string) => {
      const rm = RoomStore.getRoom(roomId);
      if (!rm || !rm.summary) return;
      rm.summary.llmSummaryText += chunk;
      rm.summary.llmSummaryCursor += chunk.length;
      RoomStore.updateRoom(rm);
      callbacks.onChunk(chunk);
    },
    onDone: (fullText: string, wasFallback: boolean) => {
      const rm = RoomStore.getRoom(roomId);
      if (rm && rm.summary) {
        rm.summary.llmSummaryText = wasFallback ? fallbackText : fullText;
        rm.summary.llmSummaryStatus = "done";
        rm.summary.llmSummaryCursor = rm.summary.llmSummaryText.length;
        RoomStore.updateRoom(rm);
      }
      callbacks.onDone(wasFallback ? fallbackText : fullText);
    },
  };

  try {
    await LlmService.streamSummaryCompletion(systemPrompt, userPrompt, streamCallbacks);
  } catch (err) {
    console.error("[summary-service] streamSummaryStream error:", err);
    const rm = RoomStore.getRoom(roomId);
    if (rm && rm.summary) {
      rm.summary.llmSummaryText = fallbackText;
      rm.summary.llmSummaryStatus = "done";
      rm.summary.llmSummaryCursor = fallbackText.length;
      RoomStore.updateRoom(rm);
    }
    callbacks.onDone(fallbackText);
  }
}

export const SummaryService = {
  initializeSummary,
  getFixedRubrics,
  startSummaryStream,
};

export default SummaryService;
