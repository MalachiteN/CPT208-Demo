import { Room, SummaryState } from "../models/types";
import { RoomStore } from "../stores/room-store";
import { ServiceResult } from "../models/types";

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

  const spokenMemberIds = new Set(
    discussion.messages
      .filter((message) => message.type === "speech" && message.speakerMemberId)
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

// Mock summary text chunks for streaming simulation
const MOCK_SUMMARY_CHUNKS = [
  "This was an interesting discussion. ",
  "The participants showed good engagement. ",
  "Key points were raised about the topic. ",
  "There was evidence of collaborative thinking. ",
  "The discussion flowed naturally with some interruptions. ",
  "Overall, this represents a typical group discussion scenario.",
];

export interface StreamChunkResult {
  chunk: string;
  isDone: boolean;
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

export function getNextSummaryChunk(roomId: string): ServiceResult<StreamChunkResult> {
  const room = RoomStore.getRoom(roomId);
  if (!room) {
    return { success: false, error: "Room not found" };
  }

  if (room.phase !== "summary") {
    return { success: false, error: "Room is not in summary phase" };
  }

  const summary = room.summary!;
  if (summary.llmSummaryStatus === "done") {
    return {
      success: true,
      data: { chunk: "", isDone: true },
    };
  }

  if (summary.llmSummaryStatus === "idle") {
    summary.llmSummaryStatus = "streaming";
  }

  const chunkIndex = summary.llmSummaryCursor;

  if (chunkIndex >= MOCK_SUMMARY_CHUNKS.length) {
    summary.llmSummaryStatus = "done";
    RoomStore.updateRoom(room);
    return {
      success: true,
      data: { chunk: "", isDone: true },
    };
  }

  const chunk = MOCK_SUMMARY_CHUNKS[chunkIndex];
  summary.llmSummaryText += chunk;
  summary.llmSummaryCursor += 1;

  if (summary.llmSummaryCursor >= MOCK_SUMMARY_CHUNKS.length) {
    summary.llmSummaryStatus = "done";
  }

  RoomStore.updateRoom(room);

  return {
    success: true,
    data: { chunk, isDone: summary.llmSummaryStatus === "done" },
  };
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

export const SummaryService = {
  initializeSummary,
  getNextSummaryChunk,
  getFixedRubrics,
};

export default SummaryService;
