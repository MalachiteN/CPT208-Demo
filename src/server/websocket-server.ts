import type { Server } from "http";
import type { IncomingMessage } from "http";
import type { Socket } from "net";
import type { WebSocketServer, WebSocket } from "ws";
import * as setupWs from "../ws/setup-ws";
import * as discussWs from "../ws/discuss-ws";
import * as summaryWs from "../ws/summary-ws";
import * as connectionManager from "../ws/connection-manager";

let wsServer: WebSocketServer | null = null;

interface Stores {
  userSessionStore: { getSession(uuid: string): { uuid: string; createdAt: number } | undefined };
  roomStore: {
    getRoom(roomId: string): import("../models/types").Room | undefined;
    deleteRoom(roomId: string): boolean;
  };
}

interface Services {
  discussionService: typeof import("../services/discussion-service").DiscussionService;
  botService: { startBotTurn: Function; interruptBot: Function };
  hintService: { generateHint: Function };
  summaryService: typeof import("../services/summary-service").SummaryService;
}

export function initialize(httpServer: Server, deps: { stores: Stores; services: Services }): WebSocketServer {
  setupWs.initialize(deps.stores.userSessionStore, deps.stores.roomStore);
  discussWs.initialize(
    deps.stores.userSessionStore,
    deps.stores.roomStore,
    deps.services.discussionService,
    deps.services.botService as never,
    deps.services.hintService as never
  );
  summaryWs.initialize(deps.stores.userSessionStore, deps.stores.roomStore, deps.services.summaryService);

  connectionManager.startHeartbeatCleanup();

  const WebSocketServerClass = require("ws").WebSocketServer;
  wsServer = new WebSocketServerClass({ noServer: true });

  httpServer.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const parsed = parseUrl(req.url || "");
    const acceptedPaths = new Set(["/api/ws/setup", "/api/ws/discuss", "/api/ws/summary"]);
    if (!acceptedPaths.has(parsed.path) || !wsServer) {
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      routeConnection(ws, parsed.path, parsed.query);
    });
  });

  if (!wsServer) {
    throw new Error("Failed to initialize websocket server");
  }
  return wsServer;
}

function routeConnection(socket: WebSocket, path: string, query: { uuid?: string; roomId?: string }): void {
  if (path === "/api/ws/setup") {
    setupWs.handleConnection(socket, query);
    return;
  }
  if (path === "/api/ws/discuss") {
    discussWs.handleConnection(socket, query);
    return;
  }
  if (path === "/api/ws/summary") {
    summaryWs.handleConnection(socket, query);
    return;
  }
  socket.close(1002, "Invalid websocket path");
}

function parseUrl(url: string): { path: string; query: { uuid?: string; roomId?: string } } {
  const [path, queryString] = url.split("?");
  const params = new URLSearchParams(queryString || "");
  return {
    path,
    query: {
      uuid: params.get("uuid") || undefined,
      roomId: params.get("roomId") || undefined,
    },
  };
}

export function getWebSocketServer(): WebSocketServer | null {
  return wsServer;
}

export async function closeWebSocketServer(): Promise<void> {
  connectionManager.stopHeartbeatCleanup();
  if (!wsServer) return;
  await new Promise<void>((resolve) => wsServer?.close(() => resolve()));
}

export { setupWs, discussWs, summaryWs, connectionManager };
