import { Room, ChatMessage } from "../models/types";
import { RoomStore } from "../stores/room-store";
import { IdService } from "./id-service";
import { ServiceResult } from "../models/types";

export interface StartSpeakingResult {
  room: Room;
  isFirstSpeaker: boolean;
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
  memberId: string
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

  RoomStore.updateRoom(room);

  return {
    success: true,
    data: { room, isFirstSpeaker },
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

  const member = getMember(room, memberId);
  if (!member) {
    return { success: false, error: "Member not found" };
  }

  if (!isEligibleNextSpeaker(room, nextSpeakerMemberId)) {
    return { success: false, error: "Invalid next speaker memberId" };
  }

  const wasLeaderUnset = discussion.leaderMemberId === null;
  const message: ChatMessage = {
    messageId: IdService.generateMessageId(),
    type: "speech",
    speakerMemberId: memberId,
    speakerDisplayName: member.displayName,
    text: overrideText || (interrupted ? "[Speech interrupted]" : `[Mock transcript from ${member.displayName}]`),
    createdAt: Date.now(),
    meta: {
      interrupted,
      round: discussion.currentRound,
      mock: true,
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
    discussion.hasInterruptionOccurred = true;
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
  if (discussion.roundSpokenMemberIds.includes(memberId)) {
    return false;
  }
  if (discussion.pendingInterruption) {
    return false;
  }
  return true;
}

export const DiscussionService = {
  startSpeaking,
  stopSpeaking,
  requestInterrupt,
  resolveInterrupt,
  canInterrupt,
};

export default DiscussionService;