import type { WebSocket } from "ws";
import type { Room } from "../models/types";
import type { ConnectionMetadata, ServerMessage } from "./message-types";
import { isHelloMessage, isPingMessage } from "./message-types";
import * as connectionManager from "./connection-manager";

interface UserSessionStore {
  getSession(uuid: string): { uuid: string; createdAt: number } | undefined;
}

interface RoomStore {
  getRoom(roomId: string): Room | undefined;
}

let userSessionStore: UserSessionStore | null = null;
let roomStore: RoomStore | null = null;

export function initialize(userStore: UserSessionStore, rmStore: RoomStore): void {
  userSessionStore = userStore;
  roomStore = rmStore;
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
  if (!room) {
    sendErrorAndClose(socket, "Room not found");
    return;
  }
  if (room.phase !== "lobby") {
    sendErrorAndClose(socket, "Room is not in lobby phase");
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

  connectionManager.registerSetupConnection(socket, metadata);

  socket.on("message", (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      if (isHelloMessage(message)) {
        const latestRoom = roomStore?.getRoom(roomId);
        if (latestRoom) {
          sendRoomUpdate(uuid, latestRoom);
        }
        return;
      }
      if (isPingMessage(message)) {
        connectionManager.updateLastPing("setup", uuid);
        socket.send(JSON.stringify({ type: "pong", ts: message.ts } satisfies ServerMessage));
      }
    } catch {
      // ignore bad payloads
    }
  });

  socket.on("close", () => connectionManager.removeSetupConnection(uuid));
  socket.on("error", () => connectionManager.removeSetupConnection(uuid));

  sendRoomUpdate(uuid, room);
}

function sendErrorAndClose(socket: WebSocket, msg: string): void {
  try {
    socket.send(JSON.stringify({ type: "error", data: { msg } } satisfies ServerMessage));
    socket.close(1008, msg);
  } catch {
    // ignore
  }
}

function sendRoomUpdate(uuid: string, room: Room): void {
  connectionManager.sendToSetupUser(uuid, {
    type: "room_update",
    data: {
      roomId: room.roomId,
      phase: room.phase,
      members: room.members,
    },
  });
}

export function broadcastRoomUpdate(room: Room): void {
  connectionManager.broadcastToRoomSetup(room.roomId, {
    type: "room_update",
    data: {
      roomId: room.roomId,
      phase: room.phase,
      members: room.members,
    },
  });
}

export function broadcastDiscussionStarted(roomId: string, ownerUuid: string): void {
  connectionManager.broadcastToRoomSetup(
    roomId,
    {
      type: "discussion_started",
      data: {
        roomId,
        redirectTo: "/discuss",
      },
    },
    ownerUuid
  );
}

export function sendRemovedFromRoom(uuid: string, roomId: string): void {
  connectionManager.sendToSetupUser(uuid, {
    type: "removed_from_room",
    data: {
      roomId,
      redirectTo: "/setup",
    },
  });
  connectionManager.removeSetupConnection(uuid);
}

export function broadcastRoomClosed(roomId: string): void {
  const message: ServerMessage = {
    type: "room_closed",
    data: { redirectTo: "/setup" },
  };
  connectionManager.broadcastToRoomSetup(roomId, message);
}
