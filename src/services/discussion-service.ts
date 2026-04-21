import { Room, ChatMessage } from "../models/types";
import { RoomStore } from "../stores/room-store";
import { IdService } from "./id-service";
import { ServiceResult } from "../models/types";
import { AudioCollectionService } from "./audio-collection-service";
import { WhisperService } from "./whisper-service";

export interface StartSpeakingResult {
  room: Room;
  isFirstSpeaker: boolean;
  mediaPath?: string;
}

function getMember(room: Room, memberId: string) {
  return room.members.find((member) => member.memberId === memberId);
}

function isEligibleNextSpeaker(room: Room, nextSpeakerMemberId: string | null): boolean {
  if (nextSpeakerMemberId === null) {
    return true;
  }
  return room.members.some((member) => member.memberId === nextSpeakerMemberId);
}

export function startSpeaking(
  roomId: string,
  memberId: string,
  mediaPath?: string
): ServiceResult<StartSpeakingResult> {
  const room = RoomStore.getRoom(roomId);
  if (!room) {
    return { success: false, error: "Room not found" };
  }

  if (room.phase !== "discuss") {
    return { success: false, error: "Room is not in discuss phase" };
  }

  const discussion = room.discussion;
  if (!discussion) {
    return { success: false, error: "Discussion not initialized" };
  }

  const member = getMember(room, memberId);
  if (!member) {
    return { success: false, error: "Member not found" };
  }

  const isFirstSpeaker = discussion.currentSpeakerMemberId === null;
  if (isFirstSpeaker) {
    discussion.currentSpeakerMemberId = memberId;
  }

  if (discussion.currentSpeakerMemberId !== memberId) {
    return { success: false, error: "You are not the assigned current speaker" };
  }

  if (discussion.currentSpeakerActive) {
    return { success: false, error: "Speaker is already actively speaking" };
  }

  discussion.currentSpeakerActive = true;

  // Start audio collection for human speakers
  let resolvedMediaPath: string | undefined;
  if (member.kind === "human") {
    const collectionPath = mediaPath ?? `room/${roomId}/${memberId}`;
    resolvedMediaPath = AudioCollectionService.startCollection(roomId, memberId, collectionPath);
  }

  RoomStore.updateRoom(room);

  return {
    success: true,
    data: { room, isFirstSpeaker, mediaPath: resolvedMediaPath },
  };
}

export interface StopSpeakingResult {
  room: Room;
  message: ChatMessage;
  roundCompleted: boolean;
}

export function stopSpeaking(
  roomId: string,
  memberId: string,
  nextSpeakerMemberId: string | null,
  interrupted = false,
  overrideText?: string
): ServiceResult<StopSpeakingResult> {
  const room = RoomStore.getRoom(roomId);
  if (!room) {
    return { success: false, error: "Room not found" };
  }

  if (room.phase !== "discuss") {
    return { success: false, error: "Room is not in discuss phase" };
  }

  const discussion = room.discussion;
  if (!discussion) {
    return { success: false, error: "Discussion not initialized" };
  }

  if (discussion.currentSpeakerMemberId !== memberId) {
    return { success: false, error: "Not the current speaker" };
  }

  if (!discussion.currentSpeakerActive) {
    return { success: false, error: "Speaker is not actively speaking" };
  }

  const member = getMember(room, memberId);
  if (!member) {
    return { success: false, error: "Member not found" };
  }

  if (!isEligibleNextSpeaker(room, nextSpeakerMemberId)) {
    return { success: false, error: "Invalid next speaker memberId" };
  }

  discussion.currentSpeakerActive = false;

  if (interrupted) {
    discussion.hasInterruptionOccurred = true;
  }

  const wasLeaderUnset = discussion.leaderMemberId === null;
  const message: ChatMessage = {
    messageId: IdService.generateMessageId(),
    type: member.kind === "bot" ? "bot_final" : "speech",
    speakerMemberId: memberId,
    speakerDisplayName: member.displayName,
    text: overrideText ?? (interrupted ? "[Speech interrupted]" : ""),
    createdAt: Date.now(),
    meta: {
      interrupted,
      round: discussion.currentRound,
    },
  };

  discussion.messages.push(message);
  if (wasLeaderUnset) {
    discussion.leaderMemberId = memberId;
  }
  discussion.lastSpeakerMemberId = memberId;
  if (!discussion.roundSpokenMemberIds.includes(memberId)) {
    discussion.roundSpokenMemberIds.push(memberId);
  }

  const allMemberIds = room.members.map((m) => m.memberId);
  const roundCompleted = allMemberIds.every((id) => discussion.roundSpokenMemberIds.includes(id));

  if (roundCompleted) {
    discussion.currentRound += 1;
    discussion.roundSpokenMemberIds = [];
  }

  discussion.currentSpeakerMemberId = nextSpeakerMemberId;
  discussion.pendingInterruption = null;

  RoomStore.updateRoom(room);

  return {
    success: true,
    data: { room, message, roundCompleted },
  };
}

/**
 * Stop a human speaker's turn, collecting audio and transcribing via whisper.
 *
 * This is the async counterpart of stopSpeaking for human speakers.
 * It:
 *   1. Calls stopSpeaking to finalize the message (with empty text initially)
 *   2. Stops audio collection and gets the audio file
 *   3. Sends the audio file to whisper for transcription
 *   4. Finalizes the message with the transcript text
 *
 * @returns The finalized message with transcript text
 */
export async function stopSpeakingAndTranscribe(
  roomId: string,
  memberId: string,
  nextSpeakerMemberId: string | null,
  interrupted = false
): Promise<ServiceResult<StopSpeakingResult>> {
  // First, do the synchronous stop-speaking state transition
  const result = stopSpeaking(roomId, memberId, nextSpeakerMemberId, interrupted);
  if (!result.success || !result.data) {
    return result;
  }

  // If interrupted, skip transcription (message already has "[Speech interrupted]")
  if (interrupted) {
    return result;
  }

  const { room, message, roundCompleted } = result.data;

  // Stop audio collection and get the file
  const { filePath } = await AudioCollectionService.stopCollection(roomId, memberId);

  // Transcribe with whisper
  const transcriptResult = await WhisperService.transcribeAndCleanup(filePath);

  // Finalize the message with the transcript
  const finalizeResult = finalizeHumanTurnWithTranscript(roomId, message.messageId, transcriptResult.text);
  if (finalizeResult.success && finalizeResult.data) {
    message.text = finalizeResult.data.text;
  }

  return {
    success: true,
    data: { room, message, roundCompleted },
  };
}

export function requestInterrupt(
  roomId: string,
  fromMemberId: string,
  targetSpeakerMemberId: string
): ServiceResult<Room> {
  const room = RoomStore.getRoom(roomId);
  if (!room) {
    return { success: false, error: "Room not found" };
  }

  if (room.phase !== "discuss") {
    return { success: false, error: "Room is not in discuss phase" };
  }

  const discussion = room.discussion;
  if (!discussion) {
    return { success: false, error: "Discussion not initialized" };
  }

  const interrupter = getMember(room, fromMemberId);
  const target = getMember(room, targetSpeakerMemberId);
  if (!interrupter || !target) {
    return { success: false, error: "Member not found" };
  }
  if (interrupter.kind !== "human") {
    return { success: false, error: "Only human members can interrupt" };
  }
  if (fromMemberId === targetSpeakerMemberId) {
    return { success: false, error: "Cannot interrupt yourself" };
  }
  if (discussion.currentSpeakerMemberId !== targetSpeakerMemberId) {
    return { success: false, error: "Target is not the current speaker" };
  }
  if (!discussion.currentSpeakerActive) {
    return { success: false, error: "Target speaker is not actively speaking" };
  }
  if (discussion.pendingInterruption) {
    return { success: false, error: "An interrupt is already pending" };
  }
  if (discussion.roundSpokenMemberIds.includes(fromMemberId)) {
    return { success: false, error: "Already spoke in this round" };
  }

  discussion.pendingInterruption = {
    fromMemberId,
    toMemberId: targetSpeakerMemberId,
    createdAt: Date.now(),
  };

  RoomStore.updateRoom(room);

  return { success: true, data: room };
}

export function resolveInterrupt(
  roomId: string,
  accepted: boolean
): ServiceResult<{ room: Room; accepted: boolean; fromMemberId: string; toMemberId: string; interruptedMessage?: ChatMessage }> {
  const room = RoomStore.getRoom(roomId);
  if (!room) {
    return { success: false, error: "Room not found" };
  }

  if (room.phase !== "discuss") {
    return { success: false, error: "Room is not in discuss phase" };
  }

  const discussion = room.discussion;
  if (!discussion) {
    return { success: false, error: "Discussion not initialized" };
  }

  const pending = discussion.pendingInterruption;
  if (!pending) {
    return { success: false, error: "No pending interruption" };
  }

  const { fromMemberId, toMemberId } = pending;
  let interruptedMessage: ChatMessage | undefined;

  if (accepted) {
    const interruptedResult = stopSpeaking(roomId, toMemberId, fromMemberId, true);
    if (!interruptedResult.success || !interruptedResult.data) {
      return { success: false, error: interruptedResult.error || "Failed to apply interruption" };
    }
    interruptedMessage = interruptedResult.data.message;
  } else {
    discussion.pendingInterruption = null;
    RoomStore.updateRoom(room);
  }

  return {
    success: true,
    data: { room, accepted, fromMemberId, toMemberId, interruptedMessage },
  };
}

export function canInterrupt(roomId: string, memberId: string): boolean {
  const room = RoomStore.getRoom(roomId);
  if (!room || room.phase !== "discuss" || !room.discussion) {
    return false;
  }

  const discussion = room.discussion;
  const member = getMember(room, memberId);
  if (!member || member.kind !== "human") {
    return false;
  }
  if (!discussion.currentSpeakerMemberId || discussion.currentSpeakerMemberId === memberId) {
    return false;
  }
  if (!discussion.currentSpeakerActive) {
    return false;
  }
  if (discussion.roundSpokenMemberIds.includes(memberId)) {
    return false;
  }
  if (discussion.pendingInterruption) {
    return false;
  }
  return true;
}

export function canRequestHint(roomId: string, memberId: string): ServiceResult<true> {
  const room = RoomStore.getRoom(roomId);
  if (!room) {
    return { success: false, error: "Room not found" };
  }

  if (room.phase !== "discuss") {
    return { success: false, error: "Room is not in discuss phase" };
  }

  const discussion = room.discussion;
  if (!discussion) {
    return { success: false, error: "Discussion not initialized" };
  }

  if (discussion.currentSpeakerMemberId !== memberId) {
    return { success: false, error: "Only the assigned current speaker can request a hint" };
  }

  if (discussion.currentSpeakerActive) {
    return { success: false, error: "Cannot request hint after speaking has started" };
  }

  return { success: true, data: true };
}

export function finalizeHumanTurnWithTranscript(
  roomId: string,
  messageId: string,
  text: string
): ServiceResult<ChatMessage> {
  const room = RoomStore.getRoom(roomId);
  if (!room) {
    return { success: false, error: "Room not found" };
  }

  const discussion = room.discussion;
  if (!discussion) {
    return { success: false, error: "Discussion not initialized" };
  }

  const message = discussion.messages.find((m) => m.messageId === messageId);
  if (!message) {
    return { success: false, error: "Message not found" };
  }

  message.text = text;
  if (message.meta) {
    delete message.meta.mock;
  }

  RoomStore.updateRoom(room);
  return { success: true, data: message };
}

export const DiscussionService = {
  startSpeaking,
  stopSpeaking,
  stopSpeakingAndTranscribe,
  requestInterrupt,
  resolveInterrupt,
  canInterrupt,
  canRequestHint,
  finalizeHumanTurnWithTranscript,
};

export default DiscussionService;
