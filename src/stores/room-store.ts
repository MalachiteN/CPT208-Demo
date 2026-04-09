import { Room, Phase, Member } from "../models/types";

// In-memory store for rooms
const rooms = new Map<string, Room>();

export function createRoom(room: Room): void {
  rooms.set(room.roomId, room);
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function hasRoom(roomId: string): boolean {
  return rooms.has(roomId);
}

export function updateRoom(room: Room): void {
  room.updatedAt = Date.now();
  rooms.set(room.roomId, room);
}

export function deleteRoom(roomId: string): boolean {
  return rooms.delete(roomId);
}

export function getAllRooms(): Room[] {
  return Array.from(rooms.values());
}

export function getRoomsByPhase(phase: Phase): Room[] {
  return getAllRooms().filter((room) => room.phase === phase);
}

export function findRoomByMemberUuid(uuid: string): Room | undefined {
  for (const room of rooms.values()) {
    const member = room.members.find((m) => m.userUuid === uuid);
    if (member) return room;
  }
  return undefined;
}

export function getMemberInRoom(roomId: string, memberId: string): Member | undefined {
  const room = rooms.get(roomId);
  if (!room) return undefined;
  return room.members.find((m) => m.memberId === memberId);
}

export function getMemberByUserUuid(roomId: string, userUuid: string): Member | undefined {
  const room = rooms.get(roomId);
  if (!room) return undefined;
  return room.members.find((m) => m.userUuid === userUuid);
}

export const RoomStore = {
  createRoom,
  getRoom,
  hasRoom,
  updateRoom,
  deleteRoom,
  getAllRooms,
  getRoomsByPhase,
  findRoomByMemberUuid,
  getMemberInRoom,
  getMemberByUserUuid,
};

export default RoomStore;
