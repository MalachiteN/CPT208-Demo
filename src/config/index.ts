import { config as dotenvConfig } from "dotenv";

// Load environment variables
dotenvConfig();

export const config = {
  // Server
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",

  // Cleanup
  roomCleanupTimeoutMs: parseInt(process.env.ROOM_CLEANUP_TIMEOUT_MS || "30000", 10),

  // Future integration placeholders
  whisperUrl: process.env.WHISPER_URL || "http://localhost:8080",
  mediamtxUrl: process.env.MEDIAMTX_URL || "http://localhost:9997",
  llmApiUrl: process.env.LLM_API_URL || "",
  llmApiKey: process.env.LLM_API_KEY || "",
};

export default config;
