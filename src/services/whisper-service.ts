import { config } from "../config/index.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Whisper Service
 *
 * Sends audio files to the whisper.cpp /inference endpoint for transcription.
 *
 * API contract:
 *   POST {WHISPER_BASEURL}/inference
 *   Content-Type: multipart/form-data
 *   Fields: file (audio), language ("auto")
 *
 * Response:
 *   { "text": "Transcribed text..." }
 *
 * On error or empty transcript, returns fallback text.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TranscriptionResult {
  text: string;
  isFallback: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FALLBACK_TEXT = "[Speech could not be transcribed]";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transcribe an audio file using whisper.cpp.
 *
 * @param filePath Absolute path to the audio file (opus, wav, mp3, etc.)
 * @returns TranscriptionResult with the transcript text and fallback flag.
 */
export async function transcribe(filePath: string): Promise<TranscriptionResult> {
  // Validate file exists
  if (!filePath || !fs.existsSync(filePath)) {
    console.warn(`[whisper-service] File not found: ${filePath}`);
    return { text: FALLBACK_TEXT, isFallback: true };
  }

  // Check file size — skip empty files
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      console.warn("[whisper-service] Audio file is empty, returning fallback");
      return { text: FALLBACK_TEXT, isFallback: true };
    }
  } catch (err) {
    console.warn("[whisper-service] Could not stat audio file:", err);
    return { text: FALLBACK_TEXT, isFallback: true };
  }

  const url = `${config.whisperBaseUrl.replace(/\/+$/, "")}/inference`;

  try {
    // Build multipart form data
    const formData = new FormData();
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const blob = new Blob([fileBuffer], { type: getMimeType(filePath) });
    formData.append("file", blob, fileName);
    formData.append("language", "auto");

    const response = await fetch(url, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(
        `[whisper-service] HTTP ${response.status}: ${errorBody.slice(0, 500)}`
      );
      return { text: FALLBACK_TEXT, isFallback: true };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const text = typeof data.text === "string" ? data.text.trim() : "";

    if (!text) {
      console.warn("[whisper-service] Empty transcript returned");
      return { text: FALLBACK_TEXT, isFallback: true };
    }

    console.log(`[whisper-service] Transcribed: "${text.slice(0, 100)}..."`);
    return { text, isFallback: false };
  } catch (err: unknown) {
    console.error("[whisper-service] Transcription request failed:", err);
    return { text: FALLBACK_TEXT, isFallback: true };
  }
}

/**
 * Transcribe and then delete the temp audio file.
 *
 * @param filePath Absolute path to the audio file
 * @returns TranscriptionResult
 */
export async function transcribeAndCleanup(filePath: string): Promise<TranscriptionResult> {
  const result = await transcribe(filePath);
  cleanupFile(filePath);
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".opus":
      return "audio/opus";
    case ".wav":
      return "audio/wav";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
      return "audio/ogg";
    case ".m4a":
      return "audio/mp4";
    case ".flac":
      return "audio/flac";
    default:
      return "application/octet-stream";
  }
}

function cleanupFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[whisper-service] Cleaned up temp file: ${filePath}`);
    }
  } catch (err) {
    console.warn(`[whisper-service] Failed to clean up ${filePath}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Service object export
// ---------------------------------------------------------------------------

export const WhisperService = {
  transcribe,
  transcribeAndCleanup,
};

export default WhisperService;
