import { config } from "../config/index.js";

/**
 * Media Service
 *
 * Handles mediamtx stream path conventions and room-level stream cleanup.
 *
 * IMPORTANT: mediamtx has three distinct endpoint concepts in this project:
 * - WebRTC (WHIP/WHEP): config.mediamtxWebRtcUrl  e.g. http://mediamtx:8889
 * - RTSP (pull for server-side recording): config.mediamtxRtspHost + port 8554
 * - HTTP API (v3 path management / cleanup): config.mediamtxApiUrl e.g. http://mediamtx:8888
 */

export function buildMediaPath(roomId: string, memberId: string): string {
  return `room/${roomId}/${memberId}`;
}

export function buildRoomPathPrefix(roomId: string): string {
  return `room/${roomId}`;
}

/**
 * If these helpers are used, they must point at the WebRTC base, not the API base.
 */
export function getWhipEndpointUrl(mediaPath: string): string {
  const base = config.mediamtxWebRtcUrl.replace(/\/+$/, "");
  return `${base}/${mediaPath}/whip`;
}

export function getWhepEndpointUrl(mediaPath: string): string {
  const base = config.mediamtxWebRtcUrl.replace(/\/+$/, "");
  return `${base}/${mediaPath}/whep`;
}

function getMediamtxApiBase(): string {
  return config.mediamtxApiUrl.replace(/\/+$/, "");
}

async function releaseStreamPath(streamPath: string): Promise<void> {
  const url = `${getMediamtxApiBase()}/v3/paths/delete/${streamPath}`;
  try {
    const response = await fetch(url, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      console.warn(`[media-service] releaseStreamPath ${streamPath} returned HTTP ${response.status}`);
    }
  } catch (err: unknown) {
    console.warn(`[media-service] releaseStreamPath ${streamPath} failed:`, err);
  }
}

async function listRoomStreamPaths(roomId: string): Promise<string[]> {
  const prefix = buildRoomPathPrefix(roomId);
  const url = `${getMediamtxApiBase()}/v3/paths/list`;
  try {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      console.warn(`[media-service] listRoomStreamPaths returned HTTP ${response.status}`);
      return [];
    }
    const data = (await response.json()) as { items?: Array<{ name: string }> };
    const items = data.items ?? [];
    return items
      .map((item) => item.name)
      .filter((name) => name.startsWith(`${prefix}/`));
  } catch (err: unknown) {
    console.warn("[media-service] listRoomStreamPaths failed:", err);
    return [];
  }
}

export async function cleanupRoomStreams(roomId: string): Promise<void> {
  const paths = await listRoomStreamPaths(roomId);
  if (paths.length === 0) {
    console.log(`[media-service] cleanupRoomStreams(${roomId}): no active paths found via API`);
    return;
  }
  console.log(`[media-service] cleanupRoomStreams(${roomId}): releasing ${paths.length} stream(s)`);
  await Promise.allSettled(paths.map((p) => releaseStreamPath(p)));
}

export async function releaseMemberStream(roomId: string, memberId: string): Promise<void> {
  const mediaPath = buildMediaPath(roomId, memberId);
  await releaseStreamPath(mediaPath);
}

export const MediaService = {
  buildMediaPath,
  buildRoomPathPrefix,
  getWhipEndpointUrl,
  getWhepEndpointUrl,
  cleanupRoomStreams,
  releaseMemberStream,
};

export default MediaService;
