import { Room, Member, DiscussionState, SummaryState, FixedRubrics } from "../models/types";
import { RoomStore } from "../stores/room-store";
import { UserSessionStore } from "../stores/user-session-store";
import { IdService } from "./id-service";
import { ServiceResult } from "../models/types";

export interface CreateRoomResult {
  room: Room;
  member: Member;
}

export interface JoinRoomResult {
  room: Room;
  member: Member;
}

export function createRoom(uuid: string): ServiceResult<CreateRoomResult> {
  if (!UserSessionStore.hasSession(uuid)) {
    return { success: false, error: "Invalid user UUID" };
  }

  const roomId = IdService.generateRoomId();
  const now = Date.now();

  const ownerMember: Member = {
    memberId: IdService.generateMemberId(),
    kind: "human",
    displayName: uuid,
    userUuid: uuid,
    isOwner: true,
    joinedAt: now,
  };

  const room: Room = {
    roomId,
    ownerUuid: uuid,
    phase: "lobby",
    members: [ownerMember],
    createdAt: now,
    updatedAt: now,
  };

  RoomStore.createRoom(room);
  console.log("[room] 房间被创建: roomId=" + roomId + ", ownerUuid=" + uuid + ", ownerMemberId=" + ownerMember.memberId);

  return {
    success: true,
    data: { room, member: ownerMember },
  };
}

export function joinRoom(uuid: string, roomId: string): ServiceResult<JoinRoomResult> {
  if (!UserSessionStore.hasSession(uuid)) {
    return { success: false, error: "Invalid user UUID" };
  }

  const room = RoomStore.getRoom(roomId);
  if (!room) {
    return { success: false, error: "Room not found" };
  }

  if (room.phase !== "lobby") {
    return { success: false, error: "Room is not in lobby phase" };
  }

  const existingMember = room.members.find((m) => m.userUuid === uuid);
  if (existingMember) {
    return {
      success: true,
      data: { room, member: existingMember },
    };
  }

  const member: Member = {
    memberId: IdService.generateMemberId(),
    kind: "human",
    displayName: uuid,
    userUuid: uuid,
    isOwner: false,
    joinedAt: Date.now(),
  };

  room.members.push(member);
  RoomStore.updateRoom(room);
  console.log("[room] 用户加入了房间: roomId=" + roomId + ", uuid=" + uuid + ", memberId=" + member.memberId + ", displayName=" + member.displayName);

  return {
    success: true,
    data: { room, member },
  };
}

export function addBot(
  ownerUuid: string,
  roomId: string,
  botName: string,
  persona: string
): ServiceResult<{ room: Room; member: Member }> {
  const room = RoomStore.getRoom(roomId);
  if (!room) {
    return { success: false, error: "Room not found" };
  }

  if (room.ownerUuid !== ownerUuid) {
    return { success: false, error: "Only owner can add bots" };
  }

  if (room.phase !== "lobby") {
    return { success: false, error: "Can only add bots in lobby phase" };
  }

  const member: Member = {
    memberId: IdService.generateBotMemberId(),
    kind: "bot",
    displayName: botName,
    botProfile: {
      name: botName,
      persona,
    },
    isOwner: false,
    joinedAt: Date.now(),
  };

  room.members.push(member);
  RoomStore.updateRoom(room);
  console.log("[room] Bot加入了房间: roomId=" + roomId + ", botMemberId=" + member.memberId + ", botName=" + botName + ", persona=" + persona);

  return {
    success: true,
    data: { room, member },
  };
}

export function removeMember(
  ownerUuid: string,
  roomId: string,
  memberId: string
): ServiceResult<{ room: Room; removedMemberId: string; removedMember: Member }> {
  const room = RoomStore.getRoom(roomId);
  if (!room) {
    return { success: false, error: "Room not found" };
  }

  if (room.ownerUuid !== ownerUuid) {
    return { success: false, error: "Only owner can remove members" };
  }

  if (room.phase !== "lobby") {
    return { success: false, error: "Can only remove members in lobby phase" };
  }

  const memberIndex = room.members.findIndex((m) => m.memberId === memberId);
  if (memberIndex === -1) {
    return { success: false, error: "Member not found" };
  }

  const member = room.members[memberIndex];

  if (member.isOwner) {
    return { success: false, error: "Owner cannot remove themselves" };
  }

  room.members.splice(memberIndex, 1);
  RoomStore.updateRoom(room);

  return {
    success: true,
    data: { room, removedMemberId: memberId, removedMember: member },
  };
}

export function startDiscussion(ownerUuid: string, roomId: string): ServiceResult<Room> {
  const room = RoomStore.getRoom(roomId);
  if (!room) {
    return { success: false, error: "Room not found" };
  }

  if (room.ownerUuid !== ownerUuid) {
    return { success: false, error: "Only owner can start discussion" };
  }

  if (room.phase !== "lobby") {
    return { success: false, error: "Room is not in lobby phase" };
  }

  const discussionState: DiscussionState = {
    currentRound: 1,
    currentSpeakerMemberId: null,
    currentSpeakerActive: false,
    roundSpokenMemberIds: [],
    leaderMemberId: null,
    lastSpeakerMemberId: null,
    hasInterruptionOccurred: false,
    pendingInterruption: null,
    messages: [],
  };

  room.phase = "discuss";
  room.discussion = discussionState;
  RoomStore.updateRoom(room);

  return { success: true, data: room };
}

export function endDiscussion(ownerUuid: string, roomId: string): ServiceResult<Room> {
  const room = RoomStore.getRoom(roomId);
  if (!room) {
    return { success: false, error: "Room not found" };
  }

  if (room.ownerUuid !== ownerUuid) {
    return { success: false, error: "Only owner can end discussion" };
  }

  if (room.phase !== "discuss") {
    return { success: false, error: "Room is not in discuss phase" };
  }

  const discussion = room.discussion!;
  const allMemberIds = room.members.map((m) => m.memberId);
  const spokenMemberIds = new Set<string>();

  discussion.messages.forEach((msg) => {
    if (msg.speakerMemberId && (msg.type === "speech" || msg.type === "bot_final")) {
      spokenMemberIds.add(msg.speakerMemberId);
    }
  });

  const everyoneSpoke = allMemberIds.every((id) => spokenMemberIds.has(id));

  const fixedRubrics: FixedRubrics = {
    everyoneSpoke,
    hasValidInterruption: discussion.hasInterruptionOccurred,
    leaderSameAsLastSpeaker:
      discussion.leaderMemberId !== null && discussion.lastSpeakerMemberId !== null
        ? discussion.leaderMemberId === discussion.lastSpeakerMemberId
        : null,
    leaderMemberId: discussion.leaderMemberId,
  };

  const summaryState: SummaryState = {
    fixedRubrics,
    llmSummaryStatus: "idle",
    llmSummaryText: "",
    llmSummaryCursor: 0,
  };

  room.phase = "summary";
  room.summary = summaryState;
  RoomStore.updateRoom(room);

  return { success: true, data: room };
}

export function getRoomState(
  uuid: string,
  roomId: string
): ServiceResult<Room> {
  const room = RoomStore.getRoom(roomId);
  if (!room) {
    return { success: false, error: "Room not found" };
  }

  const member = room.members.find((m) => m.userUuid === uuid);
  if (!member) {
    return { success: false, error: "User is not a member of this room" };
  }

  return { success: true, data: room };
}

export function isRoomOwner(uuid: string, roomId: string): boolean {
  const room = RoomStore.getRoom(roomId);
  if (!room) return false;
  return room.ownerUuid === uuid;
}

export const RoomService = {
  createRoom,
  joinRoom,
  addBot,
  removeMember,
  startDiscussion,
  endDiscussion,
  getRoomState,
  isRoomOwner,
};

export default RoomService;