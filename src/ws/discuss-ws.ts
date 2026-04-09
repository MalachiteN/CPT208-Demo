import type { WebSocket } from "ws";
import type { Member, Room } from "../models/types";
import type { ConnectionMetadata, ServerMessage } from "./message-types";
import {
  isAskHintMessage,
  isHelloMessage,
  isInterruptRequestMessage,
  isInterruptResponseMessage,
  isPingMessage,
  isStartSpeakingMessage,
  isStopSpeakingMessage,
} from "./message-types";
import * as connectionManager from "./connection-manager";

interface UserSessionStore {
  getSession(uuid: string): { uuid: string; createdAt: number } | undefined;
}

interface RoomStore {
  getRoom(roomId: string): Room | undefined;
}

interface DiscussionService {
  startSpeaking(roomId: string, memberId: string): { success: boolean; error?: string; data?: { room: Room } };
  stopSpeaking(roomId: string, memberId: string, nextSpeakerMemberId: string | null, interrupted?: boolean, overrideText?: string): { success: boolean; error?: string; data?: { room: Room; message: import("../models/types").ChatMessage } };
  requestInterrupt(roomId: string, fromMemberId: string, targetSpeakerMemberId: string): { success: boolean; error?: string };
  resolveInterrupt(roomId: string, accepted: boolean): { success: boolean; error?: string; data?: { room: Room; accepted: boolean; fromMemberId: string; toMemberId: string; interruptedMessage?: import("../models/types").ChatMessage } };
  canInterrupt(roomId: string, memberId: string): boolean;
}

interface BotService {
  startBotTurn(room: Room, botMember: Member, onChunk: (chunk: string) => void, onDone: (fullText: string) => void): void;
  interruptBot(roomId: string, memberId: string): void;
}

interface HintService {
  generateHint(room: Room, memberId: string): string;
}

let userSessionStore: UserSessionStore | null = null;
let roomStore: RoomStore | null = null;
let discussionService: DiscussionService | null = null;
let botService: BotService | null = null;
let hintService: HintService | null = null;

export function initialize(
  userStore: UserSessionStore,
  rmStore: RoomStore,
  discService: DiscussionService,
  bService: BotService,
  hService: HintService
): void {
  userSessionStore = userStore;
  roomStore = rmStore;
  discussionService = discService;
  botService = bService;
  hintService = hService;
}

export function handleConnection(socket: WebSocket, queryParams: { uuid?: string; roomId?: string }): void {
  const { uuid, roomId } = queryParams;
  if (!uuid || !roomId || !userSessionStore || !roomStore) {
    sendErrorAndClose(socket, "Invalid websocket handshake");
    return;
  }

  if (!userSessionStore.getSession(uuid)) {
    sendErrorAndClose(socket, "Invalid or expired UUID");
    return;
  }

  const room = roomStore.getRoom(roomId);
  if (!room || room.phase !== "discuss") {
    sendErrorAndClose(socket, "Room is not available for discussion websocket");
    return;
  }

  const member = room.members.find((m) => m.kind === "human" && m.userUuid === uuid);
  if (!member) {
    sendErrorAndClose(socket, "You are not a member of this room");
    return;
  }

  const metadata: ConnectionMetadata = {
    uuid,
    roomId,
    memberId: member.memberId,
    isAlive: true,
    connectedAt: Date.now(),
    lastPingAt: Date.now(),
  };
  connectionManager.registerDiscussConnection(socket, metadata);

  socket.on("message", (data: Buffer) => handleMessage(socket, uuid, roomId, member.memberId, data));
  socket.on("close", () => connectionManager.removeDiscussConnection(uuid));
  socket.on("error", () => connectionManager.removeDiscussConnection(uuid));

  sendDiscussionState(uuid, room);
}

function handleMessage(socket: WebSocket, uuid: string, roomId: string, memberId: string, data: Buffer): void {
  try {
    const message = JSON.parse(data.toString());
    if (isHelloMessage(message)) {
      const room = roomStore?.getRoom(roomId);
      if (room) sendDiscussionState(uuid, room);
      return;
    }
    if (isPingMessage(message)) {
      connectionManager.updateLastPing("discuss", uuid);
      socket.send(JSON.stringify({ type: "pong", ts: message.ts } satisfies ServerMessage));
      return;
    }
    if (isStartSpeakingMessage(message)) {
      handleStartSpeaking(uuid, roomId, memberId, message.data.mediaPath);
      return;
    }
    if (isStopSpeakingMessage(message)) {
      handleStopSpeaking(uuid, roomId, memberId, message.data.nextSpeakerMemberId);
      return;
    }
    if (isInterruptRequestMessage(message)) {
      handleInterruptRequest(uuid, roomId, memberId, message.data.targetSpeakerMemberId);
      return;
    }
    if (isInterruptResponseMessage(message)) {
      handleInterruptResponse(uuid, roomId, memberId, message.data.accepted);
      return;
    }
    if (isAskHintMessage(message)) {
      handleAskHint(uuid, roomId, memberId);
    }
  } catch {
    // ignore invalid payloads
  }
}

function sendErrorAndClose(socket: WebSocket, msg: string): void {
  try {
    socket.send(JSON.stringify({ type: "error", data: { msg } } satisfies ServerMessage));
    socket.close(1008, msg);
  } catch {
    // ignore
  }
}

function sendDiscussionState(uuid: string, room: Room): void {
  if (!room.discussion) return;
  connectionManager.sendToDiscussUser(uuid, {
    type: "discussion_state",
    data: {
      roomId: room.roomId,
      phase: "discuss",
      currentRound: room.discussion.currentRound,
      currentSpeakerMemberId: room.discussion.currentSpeakerMemberId,
      roundSpokenMemberIds: room.discussion.roundSpokenMemberIds,
      leaderMemberId: room.discussion.leaderMemberId,
      lastSpeakerMemberId: room.discussion.lastSpeakerMemberId,
      hasInterruptionOccurred: room.discussion.hasInterruptionOccurred,
      pendingInterruption: room.discussion.pendingInterruption,
      messages: room.discussion.messages,
      members: room.members,
    },
  });
}

function broadcastDiscussionState(room: Room): void {
  if (!room.discussion) return;
  connectionManager.broadcastToRoomDiscuss(room.roomId, {
    type: "discussion_state",
    data: {
      roomId: room.roomId,
      phase: "discuss",
      currentRound: room.discussion.currentRound,
      currentSpeakerMemberId: room.discussion.currentSpeakerMemberId,
      roundSpokenMemberIds: room.discussion.roundSpokenMemberIds,
      leaderMemberId: room.discussion.leaderMemberId,
      lastSpeakerMemberId: room.discussion.lastSpeakerMemberId,
      hasInterruptionOccurred: room.discussion.hasInterruptionOccurred,
      pendingInterruption: room.discussion.pendingInterruption,
      messages: room.discussion.messages,
      members: room.members,
    },
  });
}

function handleStartSpeaking(uuid: string, roomId: string, memberId: string, mediaPath?: string): void {
  if (!discussionService || !roomStore) return;
  const result = discussionService.startSpeaking(roomId, memberId);
  if (!result.success || !result.data) {
    connectionManager.sendToDiscussUser(uuid, { type: "error", data: { msg: result.error || "Cannot start speaking" } });
    return;
  }

  const room = result.data.room;
  const member = room.members.find((m) => m.memberId === memberId);
  if (!member) return;

  connectionManager.broadcastToRoomDiscuss(roomId, {
    type: "speaker_started",
    data: {
      memberId,
      displayName: member.displayName,
      mediaPath,
    },
  });
  broadcastDiscussionState(room);

  if (member.kind === "bot") {
    startBotStreaming(room, member);
  }
}

function handleStopSpeaking(uuid: string, roomId: string, memberId: string, nextSpeakerMemberId: string | null): void {
  if (!discussionService) return;
  const result = discussionService.stopSpeaking(roomId, memberId, nextSpeakerMemberId);
  if (!result.success || !result.data) {
    connectionManager.sendToDiscussUser(uuid, { type: "error", data: { msg: result.error || "Cannot stop speaking" } });
    return;
  }

  const { room, message } = result.data;
  connectionManager.broadcastToRoomDiscuss(roomId, { type: "speaker_stopped", data: { memberId } });
  connectionManager.broadcastToRoomDiscuss(roomId, { type: "message_created", data: { message } });
  broadcastDiscussionState(room);

  triggerAssignedBotTurn(room, nextSpeakerMemberId);
}

function handleInterruptRequest(uuid: string, roomId: string, fromMemberId: string, targetMemberId: string): void {
  if (!discussionService || !roomStore || !botService) return;

  if (!discussionService.canInterrupt(roomId, fromMemberId)) {
    connectionManager.sendToDiscussUser(uuid, { type: "error", data: { msg: "You cannot interrupt at this time" } });
    return;
  }

  const room = roomStore.getRoom(roomId);
  if (!room || !room.discussion) return;
  const targetMember = room.members.find((m) => m.memberId === targetMemberId);
  const fromMember = room.members.find((m) => m.memberId === fromMemberId);
  if (!targetMember || !fromMember) return;

  if (targetMember.kind === "bot") {
    handleBotInterrupt(room, fromMember, targetMember);
    return;
  }

  const result = discussionService.requestInterrupt(roomId, fromMemberId, targetMemberId);
  if (!result.success) {
    connectionManager.sendToDiscussUser(uuid, { type: "error", data: { msg: result.error || "Interrupt request failed" } });
    return;
  }

  if (targetMember.userUuid) {
    connectionManager.sendToDiscussUser(targetMember.userUuid, {
      type: "interrupt_requested",
      data: {
        fromMemberId,
        fromDisplayName: fromMember.displayName,
      },
    });
  }
}

function handleBotInterrupt(room: Room, interrupter: Member, botMember: Member): void {
  if (!discussionService || !botService) return;

  botService.interruptBot(room.roomId, botMember.memberId);

  const stopResult = discussionService.stopSpeaking(
    room.roomId,
    botMember.memberId,
    interrupter.memberId,
    true,
    `[Bot turn interrupted: ${botMember.displayName}]`
  );
  if (!stopResult.success || !stopResult.data) {
    return;
  }

  stopResult.data.room.discussion!.hasInterruptionOccurred = true;

  connectionManager.broadcastToRoomDiscuss(room.roomId, {
    type: "interrupt_resolved",
    data: {
      accepted: true,
      fromMemberId: interrupter.memberId,
      toMemberId: botMember.memberId,
    },
  });
  connectionManager.broadcastToRoomDiscuss(room.roomId, { type: "speaker_stopped", data: { memberId: botMember.memberId } });
  connectionManager.broadcastToRoomDiscuss(room.roomId, { type: "message_created", data: { message: stopResult.data.message } });
  connectionManager.broadcastToRoomDiscuss(room.roomId, {
    type: "speaker_started",
    data: { memberId: interrupter.memberId, displayName: interrupter.displayName },
  });
  broadcastDiscussionState(stopResult.data.room);
}

function handleInterruptResponse(uuid: string, roomId: string, memberId: string, accepted: boolean): void {
  if (!discussionService || !roomStore) return;
  const roomBefore = roomStore.getRoom(roomId);
  if (!roomBefore?.discussion?.pendingInterruption) {
    connectionManager.sendToDiscussUser(uuid, { type: "error", data: { msg: "No pending interruption" } });
    return;
  }

  const pending = roomBefore.discussion.pendingInterruption;
  if (pending.toMemberId !== memberId && pending.toMemberId !== roomBefore.discussion.currentSpeakerMemberId) {
    connectionManager.sendToDiscussUser(uuid, { type: "error", data: { msg: "Only the interrupted speaker can respond" } });
    return;
  }

  const result = discussionService.resolveInterrupt(roomId, accepted);
  if (!result.success || !result.data) {
    connectionManager.sendToDiscussUser(uuid, { type: "error", data: { msg: result.error || "Interrupt response failed" } });
    return;
  }

  const { room, fromMemberId, toMemberId, interruptedMessage } = result.data;
  connectionManager.broadcastToRoomDiscuss(roomId, {
    type: "interrupt_resolved",
    data: { accepted, fromMemberId, toMemberId },
  });

  if (accepted) {
    connectionManager.broadcastToRoomDiscuss(roomId, { type: "speaker_stopped", data: { memberId: toMemberId } });
    if (interruptedMessage) {
      connectionManager.broadcastToRoomDiscuss(roomId, { type: "message_created", data: { message: interruptedMessage } });
    }
    const interrupter = room.members.find((m) => m.memberId === fromMemberId);
    if (interrupter) {
      connectionManager.broadcastToRoomDiscuss(roomId, {
        type: "speaker_started",
        data: { memberId: fromMemberId, displayName: interrupter.displayName },
      });
    }
  }

  broadcastDiscussionState(room);
}

function handleAskHint(uuid: string, roomId: string, memberId: string): void {
  if (!roomStore || !hintService) return;
  const room = roomStore.getRoom(roomId);
  if (!room) return;
  const text = hintService.generateHint(room, memberId);
  connectionManager.sendToDiscussUser(uuid, { type: "hint", data: { text } });
}

function startBotStreaming(room: Room, botMember: Member): void {
  const discussionSvc = discussionService;
  if (!botService || !discussionSvc) return;
  botService.startBotTurn(
    room,
    botMember,
    (chunk) => {
      connectionManager.broadcastToRoomDiscuss(room.roomId, {
        type: "bot_stream",
        data: { memberId: botMember.memberId, chunk },
      });
    },
    (fullText) => {
      connectionManager.broadcastToRoomDiscuss(room.roomId, {
        type: "bot_done",
        data: { memberId: botMember.memberId, fullText },
      });

      const currentRoom = roomStore?.getRoom(room.roomId);
      if (!currentRoom?.discussion || currentRoom.discussion.currentSpeakerMemberId !== botMember.memberId) {
        return;
      }

      const nextSpeakerMemberId = pickNextSpeakerAfterBot(currentRoom, botMember.memberId);
      const stopResult = discussionSvc.stopSpeaking(currentRoom.roomId, botMember.memberId, nextSpeakerMemberId, false, fullText);
      if (stopResult.success && stopResult.data) {
        connectionManager.broadcastToRoomDiscuss(currentRoom.roomId, { type: "speaker_stopped", data: { memberId: botMember.memberId } });
        connectionManager.broadcastToRoomDiscuss(currentRoom.roomId, { type: "message_created", data: { message: stopResult.data.message } });
        broadcastDiscussionState(stopResult.data.room);
        triggerAssignedBotTurn(stopResult.data.room, nextSpeakerMemberId);
      }
    }
  );
}

function pickNextSpeakerAfterBot(room: Room, currentBotMemberId: string): string | null {
  const discussion = room.discussion;
  if (!discussion) {
    return null;
  }

  const eligibleNotYetSpoken = room.members.filter(
    (member) => member.memberId !== currentBotMemberId && !discussion.roundSpokenMemberIds.includes(member.memberId)
  );
  if (eligibleNotYetSpoken.length > 0) {
    return eligibleNotYetSpoken[0].memberId;
  }

  const fallback = room.members.find((member) => member.memberId !== currentBotMemberId);
  return fallback?.memberId || null;
}

function triggerAssignedBotTurn(room: Room, nextSpeakerMemberId: string | null): void {
  if (!nextSpeakerMemberId) {
    return;
  }
  const nextSpeaker = room.members.find((m) => m.memberId === nextSpeakerMemberId);
  if (nextSpeaker?.kind === "bot") {
    setTimeout(() => {
      const currentRoom = roomStore?.getRoom(room.roomId);
      if (!currentRoom?.discussion || currentRoom.discussion.currentSpeakerMemberId !== nextSpeaker.memberId) {
        return;
      }
      const botUuid = currentRoom.ownerUuid;
      handleStartSpeaking(botUuid, currentRoom.roomId, nextSpeaker.memberId);
    }, 200);
  }
}

export function broadcastDiscussionEnded(roomId: string, excludeUuid?: string): void {
  connectionManager.broadcastToRoomDiscuss(
    roomId,
    {
      type: "discussion_ended",
      data: { roomId, redirectTo: "/summary" },
    },
    excludeUuid
  );
}