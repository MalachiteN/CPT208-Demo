import express from "express";
import type { Request, Response, NextFunction } from "express";
import path from "path";
import http from "http";
import * as websocketServer from "./websocket-server";
import type { Room } from "../models/types";

const app = express();
let httpServer: http.Server | null = null;

type Stores = {
  userSessionStore: {
    createSession(session: { uuid: string; createdAt: number }): void;
    getSession(uuid: string): { uuid: string; createdAt: number } | undefined;
  };
  roomStore: {
    getRoom(roomId: string): Room | undefined;
    deleteRoom(roomId: string): boolean;
  };
};

type Services = {
  idService: { generateUuid(): string };
  roomService: typeof import("../services/room-service").RoomService;
  discussionService: typeof import("../services/discussion-service").DiscussionService;
  botService: { startBotTurn: Function; interruptBot: Function };
  hintService: { generateHint: Function };
  summaryService: typeof import("../services/summary-service").SummaryService;
};

export function createApp(stores: Stores, services: Services): { app: express.Application; server: http.Server } {
  app.use(express.json());
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  const publicPath = path.join(__dirname, "../../public");
  app.use(express.static(publicPath));

  function apiResponse<T>(res: Response, success: boolean, msg: string, data: T, statusCode = 200): void {
    res.status(statusCode).json({ success, msg, data });
  }

  app.get("/health", (_req, res) => {
    res.json({ success: true, msg: "Server is running", data: { timestamp: Date.now() } });
  });

  app.post("/api/setup", (_req, res) => {
    const session = { uuid: services.idService.generateUuid(), createdAt: Date.now() };
    stores.userSessionStore.createSession(session);
    apiResponse(res, true, "UUID created", { uuid: session.uuid });
  });

  app.post("/api/create", (req, res) => {
    const { uuid } = req.body;
    if (!uuid) return apiResponse(res, false, "UUID is required", {}, 400);
    if (!stores.userSessionStore.getSession(uuid)) return apiResponse(res, false, "Invalid or expired UUID", {}, 401);

    const result = services.roomService.createRoom(uuid);
    if (!result.success || !result.data) return apiResponse(res, false, result.error || "Failed to create room", {}, 400);

    apiResponse(res, true, "Room created", {
      roomId: result.data.room.roomId,
      ownerUuid: result.data.room.ownerUuid,
      phase: result.data.room.phase,
      members: result.data.room.members,
    });
  });

  app.post("/api/adduser", (req, res) => {
    const { uuid, roomId } = req.body;
    if (!uuid || !roomId) return apiResponse(res, false, "UUID and roomId are required", {}, 400);
    const result = services.roomService.joinRoom(uuid, roomId);
    if (!result.success || !result.data) return apiResponse(res, false, result.error || "Failed to join room", {}, 400);

    websocketServer.setupWs.broadcastRoomUpdate(result.data.room);
    apiResponse(res, true, "Joined room", {
      roomId: result.data.room.roomId,
      phase: result.data.room.phase,
      member: result.data.member,
      members: result.data.room.members,
    });
  });

  app.post("/api/addbot", (req, res) => {
    const { uuid, roomId, botName, persona } = req.body;
    if (!uuid || !roomId || !botName) return apiResponse(res, false, "UUID, roomId, and botName are required", {}, 400);
    const result = services.roomService.addBot(uuid, roomId, botName, persona || "");
    if (!result.success || !result.data) return apiResponse(res, false, result.error || "Failed to add bot", {}, 400);

    websocketServer.setupWs.broadcastRoomUpdate(result.data.room);
    apiResponse(res, true, "Bot added", {
      roomId,
      member: result.data.member,
      members: result.data.room.members,
    });
  });

  app.post("/api/remove", (req, res) => {
    const { uuid, roomId, memberId } = req.body;
    if (!uuid || !roomId || !memberId) return apiResponse(res, false, "UUID, roomId, and memberId are required", {}, 400);
    const result = services.roomService.removeMember(uuid, roomId, memberId);
    if (!result.success || !result.data) return apiResponse(res, false, result.error || "Failed to remove member", {}, 400);

    if (result.data.removedMember.kind === "human" && result.data.removedMember.userUuid) {
      websocketServer.setupWs.sendRemovedFromRoom(result.data.removedMember.userUuid, roomId);
    }
    websocketServer.setupWs.broadcastRoomUpdate(result.data.room);

    apiResponse(res, true, "Member removed", {
      roomId,
      members: result.data.room.members,
    });
  });

  app.post("/api/start", (req, res) => {
    const { uuid, roomId } = req.body;
    if (!uuid || !roomId) return apiResponse(res, false, "UUID and roomId are required", {}, 400);
    const result = services.roomService.startDiscussion(uuid, roomId);
    if (!result.success || !result.data) return apiResponse(res, false, result.error || "Failed to start discussion", {}, 400);

    websocketServer.setupWs.broadcastDiscussionStarted(roomId, uuid);
    apiResponse(res, true, "Discussion started", { roomId, phase: "discuss" });
  });

  app.post("/api/end", (req, res) => {
    const { uuid, roomId } = req.body;
    if (!uuid || !roomId) return apiResponse(res, false, "UUID and roomId are required", {}, 400);
    const endResult = services.roomService.endDiscussion(uuid, roomId);
    if (!endResult.success || !endResult.data) return apiResponse(res, false, endResult.error || "Failed to end discussion", {}, 400);

    services.summaryService.initializeSummary(roomId);
    websocketServer.discussWs.broadcastDiscussionEnded(roomId, uuid);
    apiResponse(res, true, "Discussion ended", { roomId, phase: "summary" });
  });

  app.post("/api/room/state", (req, res) => {
    const { uuid, roomId } = req.body;
    if (!uuid || !roomId) return apiResponse(res, false, "UUID and roomId are required", {}, 400);
    if (!stores.userSessionStore.getSession(uuid)) return apiResponse(res, false, "Invalid or expired UUID", {}, 401);

    const result = services.roomService.getRoomState(uuid, roomId);
    if (!result.success || !result.data) return apiResponse(res, false, result.error || "Room not found", {}, 404);

    apiResponse(res, true, "Room state fetched", {
      roomId: result.data.roomId,
      phase: result.data.phase,
      ownerUuid: result.data.ownerUuid,
      members: result.data.members,
      discussion: result.data.discussion || null,
      summary: result.data.summary || null,
    });
  });

  app.get("/setup", (_req, res) => res.sendFile(path.join(publicPath, "setup.html")));
  app.get("/create", (_req, res) => res.sendFile(path.join(publicPath, "create.html")));
  app.get("/discuss", (_req, res) => res.sendFile(path.join(publicPath, "discuss.html")));
  app.get("/summary", (_req, res) => res.sendFile(path.join(publicPath, "summary.html")));
  app.get("/", (_req, res) => res.redirect("/setup"));

  app.use((req: Request, res: Response) => {
    if (req.path.startsWith("/api/")) {
      apiResponse(res, false, "Endpoint not found", {}, 404);
      return;
    }
    res.sendFile(path.join(publicPath, "setup.html"));
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    apiResponse(res, false, "Internal server error", {}, 500);
  });

  httpServer = http.createServer(app);
  websocketServer.initialize(httpServer, { stores, services });
  return { app, server: httpServer };
}

export function getServer(): http.Server | null {
  return httpServer;
}

export { websocketServer };
