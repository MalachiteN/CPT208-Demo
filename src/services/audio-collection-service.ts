import { config } from "../config/index.js";
import { MediaService } from "./media-service.js";
import { spawn } from "node:child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Audio Collection Service
 *
 * Captures audio from mediamtx RTSP streams during human speaking turns.
 *
 * Collection strategy: RTSP pull
 *   - On startSpeaking: begin pulling from rtsp://{MEDIAMTX_HOST}:8554/{mediaPath}
 *     and buffer to a temp file.
 *   - On stopSpeaking: finalize the temp file and return its path.
 *
 * Files are stored in the OS temp directory under a room-scoped subdirectory.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActiveCollection {
  roomId: string;
  memberId: string;
  filePath: string;
  /** Node.js child process running the RTSP pull (e.g., ffmpeg or similar). */
  childProcess: import("child_process").ChildProcess | null;
  promise: Promise<string>;
  resolve: (filePath: string) => void;
  reject: (err: Error) => void;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Active collection keyed by `${roomId}:${memberId}` */
const activeCollections = new Map<string, ActiveCollection>();

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

function getTempDir(roomId: string): string {
  const dir = path.join(os.tmpdir(), "cpt208-audio", roomId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function makeTempFilePath(roomId: string, memberId: string): string {
  const dir = getTempDir(roomId);
  const ts = Date.now();
  return path.join(dir, `${memberId}_${ts}.opus`);
}

function collectionKey(roomId: string, memberId: string): string {
  return `${roomId}:${memberId}`;
}

// ---------------------------------------------------------------------------
// RTSP pull
// ---------------------------------------------------------------------------

/**
 * Determine the RTSP URL for a given media path.
 * mediamtx exposes RTSP on port 8554 by default.
 *
 * We derive the RTSP host from MEDIAMTX_BASEURL.
 * Example: http://mediamtx:8888 → rtsp://mediamtx:8554
 */
function getRtspUrl(mediaPath: string): string {
  // Parse host from the base URL
  let host = "localhost";
  try {
    const url = new URL(config.mediamtxBaseUrl);
    host = url.hostname;
  } catch {
    // fallback
  }
  return `rtsp://${host}:8554/${mediaPath}`;
}

/**
 * Spawn a subprocess that pulls RTSP audio and writes to a file.
 *
 * Uses ffmpeg if available. Falls back to a no-op stub if ffmpeg is not
 * installed (the file will be empty, but whisper will handle the error
 * gracefully with fallback text).
 */
function startRtspPull(rtspUrl: string, outputPath: string): import("child_process").ChildProcess | null {
  try {
    // ffmpeg: pull RTSP, copy codec, write to file
    const child = spawn(
      "ffmpeg",
      [
        "-y",                    // overwrite
        "-rtsp_transport", "tcp",
        "-i", rtspUrl,
        "-c:a", "copy",         // copy audio codec (opus)
        "-f", "opus",            // force opus output
        outputPath,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      }
    );

    child.stderr?.on("data", (chunk: Buffer) => {
      // Suppress verbose ffmpeg logs; only log errors
      const text = chunk.toString();
      if (text.includes("Error") || text.includes("error")) {
        console.warn(`[audio-collection] ffmpeg stderr: ${text.trim()}`);
      }
    });

    child.on("error", (err: Error) => {
      console.warn(`[audio-collection] ffmpeg process error: ${err.message}`);
    });

    return child;
  } catch (err) {
    console.warn(
      "[audio-collection] Could not spawn ffmpeg — audio collection will produce empty files. " +
      "Install ffmpeg for real audio capture.",
      err
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start capturing audio for a speaker's turn.
 *
 * @param roomId    The room ID
 * @param memberId  The speaking member's ID
 * @param mediaPath The mediamtx stream path (e.g. "room/R12345/m_abc")
 *                  If not provided, it will be derived from roomId/memberId.
 * @returns The resolved mediaPath used for collection
 */
export function startCollection(
  roomId: string,
  memberId: string,
  mediaPath?: string
): string {
  const resolvedPath = mediaPath ?? MediaService.buildMediaPath(roomId, memberId);
  const key = collectionKey(roomId, memberId);

  // Stop any existing collection for this member (should not normally happen)
  const existing = activeCollections.get(key);
  if (existing) {
    console.warn(
      `[audio-collection] startCollection called while collection active for ${key}, stopping previous`
    );
    stopExistingCollection(existing);
  }

  const filePath = makeTempFilePath(roomId, memberId);
  const rtspUrl = getRtspUrl(resolvedPath);

  let resolve!: (filePath: string) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const childProcess = startRtspPull(rtspUrl, filePath);

  const collection: ActiveCollection = {
    roomId,
    memberId,
    filePath,
    childProcess,
    promise,
    resolve,
    reject,
  };

  activeCollections.set(key, collection);

  console.log(
    `[audio-collection] Started collection for ${key} → ${filePath} (RTSP: ${rtspUrl})`
  );

  return resolvedPath;
}

/**
 * Stop capturing audio for a speaker's turn.
 *
 * @returns Promise resolving to { filePath, mimeType } of the collected audio file.
 */
export async function stopCollection(
  roomId: string,
  memberId: string
): Promise<{ filePath: string; mimeType: string }> {
  const key = collectionKey(roomId, memberId);
  const collection = activeCollections.get(key);

  if (!collection) {
    console.warn(
      `[audio-collection] stopCollection called but no active collection for ${key}`
    );
    // Return a fallback empty file path
    const filePath = makeTempFilePath(roomId, memberId);
    return { filePath, mimeType: "audio/opus" };
  }

  activeCollections.delete(key);
  stopExistingCollection(collection);

  // Wait a short time for the file to be flushed
  await new Promise((r) => setTimeout(r, 200));

  // Check if the file has content
  let fileSize = 0;
  try {
    const stat = fs.statSync(collection.filePath);
    fileSize = stat.size;
  } catch {
    // File may not exist if ffmpeg failed
  }

  console.log(
    `[audio-collection] Stopped collection for ${key} → ${collection.filePath} (${fileSize} bytes)`
  );

  return {
    filePath: collection.filePath,
    mimeType: "audio/opus",
  };
}

/**
 * Clean up temporary audio files for a specific collection.
 */
export function cleanupCollection(roomId: string, memberId: string): void {
  const key = collectionKey(roomId, memberId);
  const collection = activeCollections.get(key);

  if (collection) {
    activeCollections.delete(key);
    stopExistingCollection(collection);
  }

  // Attempt to remove temp files for this member
  const dir = getTempDir(roomId);
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.startsWith(`${memberId}_`)) {
        const fullPath = path.join(dir, file);
        try {
          fs.unlinkSync(fullPath);
          console.log(`[audio-collection] Cleaned up temp file: ${fullPath}`);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // dir may not exist
  }
}

/**
 * Clean up all audio collection state and temp files for a room.
 * Should be called when discussion ends.
 */
export function cleanupRoomAudio(roomId: string): void {
  // Stop all active collections for this room
  for (const [key, collection] of activeCollections) {
    if (collection.roomId === roomId) {
      activeCollections.delete(key);
      stopExistingCollection(collection);
    }
  }

  // Remove temp directory for this room
  const dir = path.join(os.tmpdir(), "cpt208-audio", roomId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`[audio-collection] Cleaned up room temp dir: ${dir}`);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stopExistingCollection(collection: ActiveCollection): void {
  if (collection.childProcess) {
    try {
      // Send SIGINT first for graceful shutdown
      collection.childProcess.kill("SIGINT");
      // Force kill after a short timeout
      setTimeout(() => {
        try {
          collection.childProcess?.kill("SIGKILL");
        } catch {
          // already exited
        }
      }, 1000);
    } catch {
      // process may have already exited
    }
  }
  // Resolve the promise with whatever file we have
  collection.resolve(collection.filePath);
}

// ---------------------------------------------------------------------------
// Service object export
// ---------------------------------------------------------------------------

export const AudioCollectionService = {
  startCollection,
  stopCollection,
  cleanupCollection,
  cleanupRoomAudio,
};

export default AudioCollectionService;
