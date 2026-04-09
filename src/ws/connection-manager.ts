import type { ConnectionMetadata } from "./message-types";
import type { ServerMessage } from "./message-types";

type WebSocket = import("ws").WebSocket;
type PhaseKey = "setup" | "discuss" | "summary";

export interface ConnectionEntry {
  socket: WebSocket;
  metadata: ConnectionMetadata;
}

const setupConnections = new Map<string, ConnectionEntry>();
const discussConnections = new Map<string, ConnectionEntry>();
const summaryConnections = new Map<string, ConnectionEntry>();

const HEARTBEAT_INTERVAL_MS = 30000;
const HEARTBEAT_TIMEOUT_MS = 35000;

let heartbeatInterval: NodeJS.Timeout | null = null;
let summaryStaleHandler: ((roomId: string) => void) | null = null;

function getPhaseStore(phase: PhaseKey): Map<string, ConnectionEntry> {
  if (phase === "setup") return setupConnections;
  if (phase === "discuss") return discussConnections;
  return summaryConnections;
}

function closeConnection(socket: WebSocket, reason: string): void {
  try {
    if (socket.readyState === 1) {
      socket.close(1000, reason);
    }
  } catch {
    // ignore
  }
}

function registerConnection(phase: PhaseKey, socket: WebSocket, metadata: ConnectionMetadata): void {
  const store = getPhaseStore(phase);
  const existing = store.get(metadata.uuid);
  if (existing) {
    closeConnection(existing.socket, "replaced_by_new_connection");
  }
  store.set(metadata.uuid, { socket, metadata });
}

function removeConnection(phase: PhaseKey, uuid: string): void {
  const store = getPhaseStore(phase);
  const entry = store.get(uuid);
  if (!entry) return;
  closeConnection(entry.socket, "connection_removed");
  store.delete(uuid);
}

function sendToUser(store: Map<string, ConnectionEntry>, uuid: string, message: ServerMessage): boolean {
  const entry = store.get(uuid);
  if (!entry || entry.socket.readyState !== 1) return false;
  try {
    entry.socket.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function broadcastToRoom(store: Map<string, ConnectionEntry>, roomId: string, message: ServerMessage, excludeUuid?: string): void {
  const payload = JSON.stringify(message);
  for (const entry of store.values()) {
    if (entry.metadata.roomId !== roomId) continue;
    if (excludeUuid && entry.metadata.uuid === excludeUuid) continue;
    try {
      if (entry.socket.readyState === 1) {
        entry.socket.send(payload);
      }
    } catch {
      // ignore single-send errors
    }
  }
}

export function registerSetupConnection(socket: WebSocket, metadata: ConnectionMetadata): void {
  registerConnection("setup", socket, metadata);
}

export function registerDiscussConnection(socket: WebSocket, metadata: ConnectionMetadata): void {
  registerConnection("discuss", socket, metadata);
}

export function registerSummaryConnection(socket: WebSocket, metadata: ConnectionMetadata): void {
  registerConnection("summary", socket, metadata);
}

export function removeSetupConnection(uuid: string): void {
  removeConnection("setup", uuid);
}

export function removeDiscussConnection(uuid: string): void {
  removeConnection("discuss", uuid);
}

export function removeSummaryConnection(uuid: string): void {
  removeConnection("summary", uuid);
}

export function removeAllConnectionsForUser(uuid: string): void {
  removeSetupConnection(uuid);
  removeDiscussConnection(uuid);
  removeSummaryConnection(uuid);
}

export function removeAllConnectionsForRoom(roomId: string): void {
  for (const store of [setupConnections, discussConnections, summaryConnections]) {
    for (const [uuid, entry] of store.entries()) {
      if (entry.metadata.roomId === roomId) {
        closeConnection(entry.socket, "room_closed");
        store.delete(uuid);
      }
    }
  }
}

export function getSetupConnection(uuid: string): ConnectionEntry | undefined {
  return setupConnections.get(uuid);
}

export function getDiscussConnection(uuid: string): ConnectionEntry | undefined {
  return discussConnections.get(uuid);
}

export function getSummaryConnection(uuid: string): ConnectionEntry | undefined {
  return summaryConnections.get(uuid);
}

export function getSetupConnectionsForRoom(roomId: string): ConnectionEntry[] {
  return Array.from(setupConnections.values()).filter((entry) => entry.metadata.roomId === roomId);
}

export function getDiscussConnectionsForRoom(roomId: string): ConnectionEntry[] {
  return Array.from(discussConnections.values()).filter((entry) => entry.metadata.roomId === roomId);
}

export function getSummaryConnectionsForRoom(roomId: string): ConnectionEntry[] {
  return Array.from(summaryConnections.values()).filter((entry) => entry.metadata.roomId === roomId);
}

export function updateLastPing(phase: PhaseKey, uuid: string): void {
  const entry = getPhaseStore(phase).get(uuid);
  if (!entry) return;
  entry.metadata.lastPingAt = Date.now();
  entry.metadata.isAlive = true;
}

export function hasAliveSummaryConnections(roomId: string): boolean {
  const now = Date.now();
  return getSummaryConnectionsForRoom(roomId).some((entry) => now - entry.metadata.lastPingAt < HEARTBEAT_TIMEOUT_MS);
}

export function onSummaryConnectionStale(handler: (roomId: string) => void): void {
  summaryStaleHandler = handler;
}

export function broadcastToRoomSetup(roomId: string, message: ServerMessage, excludeUuid?: string): void {
  broadcastToRoom(setupConnections, roomId, message, excludeUuid);
}

export function broadcastToRoomDiscuss(roomId: string, message: ServerMessage, excludeUuid?: string): void {
  broadcastToRoom(discussConnections, roomId, message, excludeUuid);
}

export function broadcastToRoomSummary(roomId: string, message: ServerMessage, excludeUuid?: string): void {
  broadcastToRoom(summaryConnections, roomId, message, excludeUuid);
}

export function sendToSetupUser(uuid: string, message: ServerMessage): boolean {
  return sendToUser(setupConnections, uuid, message);
}

export function sendToDiscussUser(uuid: string, message: ServerMessage): boolean {
  return sendToUser(discussConnections, uuid, message);
}

export function sendToSummaryUser(uuid: string, message: ServerMessage): boolean {
  return sendToUser(summaryConnections, uuid, message);
}

export function startHeartbeatCleanup(): void {
  if (heartbeatInterval) return;

  heartbeatInterval = setInterval(() => {
    const now = Date.now();

    for (const [uuid, entry] of setupConnections.entries()) {
      if (now - entry.metadata.lastPingAt > HEARTBEAT_TIMEOUT_MS) {
        closeConnection(entry.socket, "heartbeat_timeout");
        setupConnections.delete(uuid);
      }
    }

    for (const [uuid, entry] of discussConnections.entries()) {
      if (now - entry.metadata.lastPingAt > HEARTBEAT_TIMEOUT_MS) {
        closeConnection(entry.socket, "heartbeat_timeout");
        discussConnections.delete(uuid);
      }
    }

    for (const [uuid, entry] of summaryConnections.entries()) {
      if (now - entry.metadata.lastPingAt > HEARTBEAT_TIMEOUT_MS) {
        const roomId = entry.metadata.roomId;
        closeConnection(entry.socket, "heartbeat_timeout");
        summaryConnections.delete(uuid);
        if (summaryStaleHandler && !hasAliveSummaryConnections(roomId)) {
          summaryStaleHandler(roomId);
        }
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

export function stopHeartbeatCleanup(): void {
  if (!heartbeatInterval) return;
  clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}
