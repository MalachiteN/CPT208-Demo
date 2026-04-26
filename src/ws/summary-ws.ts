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
  deleteRoom(roomId: string): boolean;
}

interface SummaryService {
  getFixedRubrics(roomId: string): { success: boolean; error?: string; data?: import("../models/types").FixedRubrics };
  startSummaryStream(
    roomId: string,
    callbacks: {
      onChunk: (chunk: string, reasoningChunk?: string) => void;
      onDone: (fullText: string, reasoningContent?: string) => void;
    }
  ): Promise<void>;
}

let userSessionStore: UserSessionStore | null = null;
let roomStore: RoomStore | null = null;
let summaryService: SummaryService | null = null;

const roomCleanupTimers = new Map<string, NodeJS.Timeout>();
const CLEANUP_TIMEOUT_MS = 30000;
const STALE_RECHECK_DELAY_MS = 1000;
const streamingRooms = new Set<string>();
const closedRooms = new Set<string>();

export function initialize(userStore: UserSessionStore, rmStore: RoomStore, sumService: SummaryService): void {
  userSessionStore = userStore;
  roomStore = rmStore;
  summaryService = sumService;
  connectionManager.onSummaryConnectionStale((roomId) => checkAndScheduleRoomCleanup(roomId));
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
    sendErrorAndClose(socket, "Room no longer exists; return to /setup");
    return;
  }
  if (room.phase !== "summary") {
    sendErrorAndClose(socket, "Room is not in summary phase");
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
  connectionManager.registerSummaryConnection(socket, metadata);
  console.log(`[summary-ws] Summary连接建立: uuid=${uuid}, roomId=${roomId}, memberId=${member.memberId}, displayName=${member.displayName}`);

  socket.on("message", (data: Buffer) => handleMessage(socket, uuid, roomId, data));
  socket.on("close", () => {
    console.log(`[summary-ws] Summary连接断开: uuid=${uuid}, roomId=${roomId}, memberId=${member.memberId}`);
    connectionManager.removeSummaryConnection(uuid);
    checkAndScheduleRoomCleanup(roomId);
  });
  socket.on("error", () => {
    console.log(`[summary-ws] Summary连接错误断开: uuid=${uuid}, roomId=${roomId}, memberId=${member.memberId}`);
    connectionManager.removeSummaryConnection(uuid);
    checkAndScheduleRoomCleanup(roomId);
  });

  cancelRoomCleanup(roomId);
  sendFixedRubrics(uuid, roomId);
  ensureSummaryStream(roomId);
}

function handleMessage(socket: WebSocket, uuid: string, roomId: string, data: Buffer): void {
  try {
    const message = JSON.parse(data.toString());
    if (isHelloMessage(message)) {
      sendFixedRubrics(uuid, roomId);
      ensureSummaryStream(roomId);
      return;
    }
    if (isPingMessage(message)) {
      connectionManager.updateLastPing("summary", uuid);
      cancelRoomCleanup(roomId);
      socket.send(JSON.stringify({ type: "pong", ts: message.ts } satisfies ServerMessage));
    }
  } catch {
    // ignore
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

function sendFixedRubrics(uuid: string, roomId: string): void {
  if (!summaryService) return;
  const result = summaryService.getFixedRubrics(roomId);
  if (!result.success || !result.data) return;
  connectionManager.sendToSummaryUser(uuid, {
    type: "summary_fixed",
    data: result.data,
  });
}

/**
 * Start real LLM summary streaming for a room.
 * Uses cursor-based progression via the summary service.
 * Prevents duplicate concurrent streams per room.
 */
function ensureSummaryStream(roomId: string): void {
  const service = summaryService;
  if (!service || streamingRooms.has(roomId)) return;

  const room = roomStore?.getRoom(roomId);
  if (!room || room.phase !== "summary") return;

  // Check if already done
  if (room.summary?.llmSummaryStatus === "done") {
    // Re-emit to any late joiners — the full text is already stored
    const summary = room.summary as { llmSummaryText: string; llmSummaryReasoningContent?: string };
    connectionManager.broadcastToRoomSummary(roomId, {
      type: "summary_done",
      data: { fullText: summary.llmSummaryText, reasoningContent: summary.llmSummaryReasoningContent },
    });
    return;
  }

  streamingRooms.add(roomId);

  service.startSummaryStream(roomId, {
    onChunk: (chunk: string, reasoningChunk?: string) => {
      connectionManager.broadcastToRoomSummary(roomId, {
        type: "summary_stream",
        data: { chunk, reasoningContent: reasoningChunk },
      });
    },
    onDone: (fullText: string, reasoningContent?: string) => {
      connectionManager.broadcastToRoomSummary(roomId, {
        type: "summary_done",
        data: { fullText, reasoningContent },
      });
      streamingRooms.delete(roomId);
    },
  }).catch((err) => {
    console.error(`[summary-ws] Summary stream error for room ${roomId}:`, err);
    streamingRooms.delete(roomId);
  });
}

function checkAndScheduleRoomCleanup(roomId: string): void {
  setTimeout(() => {
    if (!roomStore?.getRoom(roomId)) {
      cancelRoomCleanup(roomId);
      return;
    }

    if (connectionManager.hasAliveSummaryConnections(roomId)) {
      cancelRoomCleanup(roomId);
      return;
    }

    console.log(`[summary-ws] 总结室无存活连接，准备调度房间清理: roomId=${roomId}, aliveConnections=0`);
    scheduleRoomCleanup(roomId);
  }, STALE_RECHECK_DELAY_MS);
}

function scheduleRoomCleanup(roomId: string): void {
  if (roomCleanupTimers.has(roomId)) {
    return;
  }

  console.log(`[summary-ws] 所有用户退出总结室，准备销毁房间: roomId=${roomId}`);
  roomCleanupTimers.set(
    roomId,
    setTimeout(() => {
      roomCleanupTimers.delete(roomId);

      if (!roomStore?.getRoom(roomId)) {
        return;
      }

      if (connectionManager.hasAliveSummaryConnections(roomId)) {
        return;
      }

      closedRooms.add(roomId);
      connectionManager.broadcastToRoomSummary(roomId, {
        type: "room_closed",
        data: { redirectTo: "/setup" },
      });

      setTimeout(() => {
        connectionManager.removeAllConnectionsForRoom(roomId);
        console.log(`[summary-ws] 房间即将销毁: roomId=${roomId}`);
        roomStore?.deleteRoom(roomId);
        console.log(`[summary-ws] 房间已销毁: roomId=${roomId}`);
      }, 200);
    }, CLEANUP_TIMEOUT_MS)
  );
}

function cancelRoomCleanup(roomId: string): void {
  closedRooms.delete(roomId);
  const timer = roomCleanupTimers.get(roomId);
  if (!timer) return;
  clearTimeout(timer);
  roomCleanupTimers.delete(roomId);
}

export function broadcastRoomClosed(roomId: string): void {
  connectionManager.broadcastToRoomSummary(roomId, {
    type: "room_closed",
    data: { redirectTo: "/setup" },
  });
}
