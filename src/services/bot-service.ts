import { ServiceResult } from "../models/types";

// Mock bot text generation for streaming simulation
const MOCK_BOT_RESPONSES = [
  "I think this is an interesting topic worth discussing further.",
  "From my perspective, there are multiple angles to consider here.",
  "Let me share my thoughts on this matter based on my experience.",
  "This reminds me of similar discussions I've had before.",
  "I would approach this problem by first understanding the core issues.",
  "In my opinion, collaboration is key to finding the best solution.",
];

// Bot streaming state (in-memory)
const botStreams = new Map<string, {
  responseIndex: number;
  chunkIndex: number;
  response: string;
}>();

export interface BotStreamResult {
  chunk: string;
  isDone: boolean;
  fullText: string;
}

export function startBotStream(memberId: string): ServiceResult<void> {
  const responseIndex = Math.floor(Math.random() * MOCK_BOT_RESPONSES.length);
  botStreams.set(memberId, {
    responseIndex,
    chunkIndex: 0,
    response: MOCK_BOT_RESPONSES[responseIndex],
  });
  return { success: true };
}

export function getNextBotChunk(memberId: string): ServiceResult<BotStreamResult> {
  const stream = botStreams.get(memberId);
  if (!stream) {
    return { success: false, error: "No active bot stream" };
  }

  const words = stream.response.split(" ");
  const chunkSize = Math.floor(Math.random() * 3) + 1; // 1-3 words per chunk

  if (stream.chunkIndex >= words.length) {
    // Stream complete
    botStreams.delete(memberId);
    return {
      success: true,
      data: {
        chunk: "",
        isDone: true,
        fullText: stream.response,
      },
    };
  }

  const chunk = words
    .slice(stream.chunkIndex, stream.chunkIndex + chunkSize)
    .join(" ");
  stream.chunkIndex += chunkSize;

  const isDone = stream.chunkIndex >= words.length;
  if (isDone) {
    botStreams.delete(memberId);
  }

  return {
    success: true,
    data: {
      chunk: chunk + (isDone ? "" : " "),
      isDone,
      fullText: stream.response,
    },
  };
}

export function abortBotStream(memberId: string): void {
  botStreams.delete(memberId);
}

export function isBotStreaming(memberId: string): boolean {
  return botStreams.has(memberId);
}

export const BotService = {
  startBotStream,
  getNextBotChunk,
  abortBotStream,
  isBotStreaming,
};

export default BotService;
