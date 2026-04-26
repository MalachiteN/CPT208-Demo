import { config as dotenvConfig } from "dotenv";

// Load environment variables
dotenvConfig();

export const config = {
  // Server
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",

  // Cleanup
  roomCleanupTimeoutMs: parseInt(process.env.ROOM_CLEANUP_TIMEOUT_MS || "30000", 10),

  // LLM configuration (Stage 2)
  openaiBaseUrl: process.env.OPENAI_BASEURL || "https://zenmux.ai/api/v1",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  roleplayModel: process.env.ROLEPLAY_MODEL || "minimax/minimax-m2-her",
  hintModel: process.env.HINT_MODEL || "stepfun/step-3.5-flash",
  summaryModel: process.env.SUMMARY_MODEL || "moonshotai/kimi-k2.5",

  // External service URLs (Stage 2)
  whisperBaseUrl: process.env.WHISPER_BASEURL || "http://localhost:8080",

  // LLM thinking control (per call type)
  // Set to "true" to disable thinking for specific call types
  disableThinkingRoleplay: process.env.DISABLE_THINKING_ROLEPLAY === "true",
  disableThinkingHint: process.env.DISABLE_THINKING_HINT === "true",
  disableThinkingSummary: process.env.DISABLE_THINKING_SUMMARY === "true",

  // mediamtx — three separate concerns:
  // WebRTC (WHIP/WHEP): port 8889
  // RTSP (audio pull):  port 8554 (hostname only, used for rtsp:// URL)
  // HTTP API (v3):      port 8888 (for path management / cleanup)
  mediamtxWebRtcUrl: process.env.MEDIAMTX_WEBRTC_URL || "http://mediamtx:8889",
  mediamtxRtspHost: process.env.MEDIAMTX_RTSP_HOST || "mediamtx",
  mediamtxRtspPort: parseInt(process.env.MEDIAMTX_RTSP_PORT || "8554", 10),
  mediamtxApiUrl: process.env.MEDIAMTX_API_URL || "http://mediamtx:8888",
};

export default config;
