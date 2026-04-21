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
  mediamtxBaseUrl: process.env.MEDIAMTX_BASEURL || "http://localhost:8888",
};

export default config;
