import { config } from "../config/index.js";

/**
 * Media Service
 *
 * Handles mediamtx stream path conventions, WHIP/WHEP endpoint URL helpers,
 * and room-level stream cleanup via the mediamtx HTTP API.
 *
 * Stream path convention: room/{roomId}/{memberId}
 */

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Build the canonical mediamtx stream path for a room member.
 * Format: room/{roomId}/{memberId}
 */
export function buildMediaPath(roomId: string, memberId: string): string {
  return `room/${roomId}/${memberId}`;
}

/**
 * Build the mediamtx path prefix for all streams in a room.
 * Format: room/{roomId}
 */
export function buildRoomPathPrefix(roomId: string): string {
  return `room/${roomId}`;
}

// ---------------------------------------------------------------------------
// WHIP / WHEP endpoint helpers
// ---------------------------------------------------------------------------

/**
 * Get the WHIP endpoint URL for pushing audio from a browser to mediamtx.
 * Format: {MEDIAMTX_BASEURL}/{mediaPath}/whip
 *
 * Example: http://mediamtx:8888/room/R12345/m_abc/whip
 */
export function getWhipEndpointUrl(mediaPath: string): string {
  const base = config.mediamtxBaseUrl.replace(/\/+$/, "");
  return `${base}/${mediaPath}/whip`;
}

/**
 * Get the WHEP endpoint URL for pulling audio from mediamtx to a browser.
 * Format: {MEDIAMTX_BASEURL}/{mediaPath}/whep
 *
 * Example: http://mediamtx:8888/room/R12345/m_abc/whep
 */
export function getWhepEndpointUrl(mediaPath: string): string {
  const base = config.mediamtxBaseUrl.replace(/\/+$/, "");
  return `${base}/${mediaPath}/whep`;
}

// ---------------------------------------------------------------------------
// mediamtx API interaction
// ---------------------------------------------------------------------------

/**
 * Get the mediamtx API base URL (same as MEDIAMTX_BASEURL in prototype).
 */
function getMediamtxApiBase(): string {
  return config.mediamtxBaseUrl.replace(/\/+$/, "");
}

/**
 * Request mediamtx to delete (release) a specific stream path.
 * Uses the mediamtx v3 HTTP API: DELETE /v3/paths/get/{path}
 *
 * This is best-effort — failures are logged but not thrown.
 */
async function releaseStreamPath(streamPath: string): Promise<void> {
  const url = `${getMediamtxApiBase()}/v3/paths/delete/${streamPath}`;
  try {
    const response = await fetch(url, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      console.warn(
        `[media-service] releaseStreamPath ${streamPath} returned HTTP ${response.status}`
      );
    }
  } catch (err: unknown) {
    // Best-effort cleanup — do not throw
    console.warn(`[media-service] releaseStreamPath ${streamPath} failed:`, err);
  }
}

/**
 * List active paths under a room prefix by querying mediamtx API.
 * Uses GET /v3/paths/list to enumerate all active paths, then filters
 * to those matching room/{roomId}/*.
 *
 * Falls back to a fixed list if the API call fails.
 */
async function listRoomStreamPaths(roomId: string): Promise<string[]> {
  const prefix = buildRoomPathPrefix(roomId);
  const url = `${getMediamtxApiBase()}/v3/paths/list`;
  try {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      console.warn(
        `[media-service] listRoomStreamPaths returned HTTP ${response.status}`
      );
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

/**
 * Clean up all mediamtx streams for a given room.
 *
 * Releases all stream paths matching room/{roomId}/*.
 * This should be called when discussion ends to prevent lingering streams.
 */
export async function cleanupRoomStreams(roomId: string): Promise<void> {
  const paths = await listRoomStreamPaths(roomId);
  if (paths.length === 0) {
    // Fallback: try releasing known member paths via the room store.
    // The caller may also supply known paths directly if needed.
    console.log(
      `[media-service] cleanupRoomStreams(${roomId}): no active paths found via API`
    );
    return;
  }
  console.log(
    `[media-service] cleanupRoomStreams(${roomId}): releasing ${paths.length} stream(s)`
  );
  await Promise.allSettled(paths.map((p) => releaseStreamPath(p)));
}

/**
 * Release a single known stream path (e.g., after a speaker stops).
 */
export async function releaseMemberStream(
  roomId: string,
  memberId: string
): Promise<void> {
  const mediaPath = buildMediaPath(roomId, memberId);
  await releaseStreamPath(mediaPath);
}

// ---------------------------------------------------------------------------
// Service object export
// ---------------------------------------------------------------------------

export const MediaService = {
  buildMediaPath,
  buildRoomPathPrefix,
  getWhipEndpointUrl,
  getWhepEndpointUrl,
  cleanupRoomStreams,
  releaseMemberStream,
};

export default MediaService;
