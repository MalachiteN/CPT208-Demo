import { config } from "../config/index.js";

/**
 * LLM Service
 *
 * Centralized OpenAI-compatible chat completion client that supports:
 * - Streaming mode (for bot roleplay turns and summary evaluation)
 * - Non-streaming mode (for hint generation)
 * - AbortController-based cancellation for streaming calls
 * - Model selection by call type (roleplay / hint / summary)
 * - Graceful HTTP error handling with fallback text
 *
 * Config is read from the existing src/config/index.ts module:
 *   OPENAI_BASEURL, OPENAI_API_KEY, ROLEPLAY_MODEL, HINT_MODEL, SUMMARY_MODEL
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LlmCallType = "roleplay" | "hint" | "summary";

export interface StreamCallbacks {
  onChunk: (chunk: string, reasoningChunk?: string) => void;
  onDone: (fullText: string, wasFallback: boolean, reasoningContent?: string) => void;
}

export interface LlmError {
  status?: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Model selection
// ---------------------------------------------------------------------------

/**
 * Resolve the model name for a given call type.
 */
export function getModelForCallType(callType: LlmCallType): string {
  switch (callType) {
    case "roleplay":
      return config.roleplayModel;
    case "hint":
      return config.hintModel;
    case "summary":
      return config.summaryModel;
  }
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

interface ChatCompletionRequest {
  model: string;
  stream: boolean;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  thinking?: { type: "enabled" | "disabled" };
}

function buildRequestBody(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  stream: boolean,
  disableThinking?: boolean,
): ChatCompletionRequest {
  const body: ChatCompletionRequest = {
    model,
    stream,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };

  if (disableThinking) {
    body.thinking = { type: "disabled" };
  }

  return body;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function getChatCompletionsUrl(): string {
  const base = config.openaiBaseUrl.replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

function getHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.openaiApiKey}`,
  };
}

// ---------------------------------------------------------------------------
// SSE stream parser
// ---------------------------------------------------------------------------

/**
 * Parse a Server-Sent Events stream from an OpenAI-compatible chat
 * completion endpoint and extract content delta chunks.
 *
 * The stream format is:
 *   data: {"choices":[{"delta":{"content":"..."}}]}
 *   data: [DONE]
 */
async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunk: string, reasoningChunk?: string) => void,
  abortSignal?: AbortSignal,
): Promise<{ content: string; reasoningContent: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let reasoningAccumulated = "";
  let buffer = "";

  try {
    while (true) {
      if (abortSignal?.aborted) {
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue; // skip empty/comments

        if (trimmed === "data: [DONE]") {
          return { content: accumulated, reasoningContent: reasoningAccumulated };
        }

        if (trimmed.startsWith("data: ")) {
          const jsonStr = trimmed.slice(6);
          try {
            const parsed = JSON.parse(jsonStr);
            const content: string | undefined =
              parsed?.choices?.[0]?.delta?.content;
            const reasoningContent: string | undefined =
              parsed?.choices?.[0]?.delta?.reasoning_content;
            if (content) {
              accumulated += content;
              onChunk(content, reasoningContent);
            } else if (reasoningContent) {
              reasoningAccumulated += reasoningContent;
              onChunk("", reasoningContent);
            }
          } catch {
            // Skip malformed JSON chunks — some providers emit extra whitespace
            // or non-JSON lines; we tolerate them silently.
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { content: accumulated, reasoningContent: reasoningAccumulated };
}

// ---------------------------------------------------------------------------
// Public API — streaming chat completion
// ---------------------------------------------------------------------------

/**
 * Perform a streaming OpenAI-compatible chat completion request.
 *
 * @param model       Model name (e.g. from getModelForCallType)
 * @param systemPrompt  System prompt text
 * @param userPrompt    User prompt text (assembled by discussion-prompt-builder)
 * @param callbacks   { onChunk, onDone } — onChunk receives each text delta,
 *                    onDone receives the full accumulated text when the stream
 *                    ends (or fallback text on error).
 * @param fallbackText  Text to deliver via onDone if the LLM call fails entirely.
 * @param abortSignal  Optional AbortSignal for cancelling the in-flight request.
 * @param disableThinking  Optional flag to disable model thinking (Moonshot API)
 */
export async function streamChatCompletion(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  callbacks: StreamCallbacks,
  fallbackText: string,
  abortSignal?: AbortSignal,
  disableThinking?: boolean,
): Promise<void> {
  const url = getChatCompletionsUrl();
  const body = buildRequestBody(model, systemPrompt, userPrompt, true, disableThinking);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(body),
      signal: abortSignal ?? null,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(
        `[llm-service] streamChatCompletion HTTP ${response.status}: ${errorBody.slice(0, 500)}`,
      );
      callbacks.onChunk(fallbackText);
      callbacks.onDone(fallbackText, true);
      return;
    }

    if (!response.body) {
      console.error("[llm-service] streamChatCompletion: response body is null");
      callbacks.onChunk(fallbackText);
      callbacks.onDone(fallbackText, true);
      return;
    }

    const { content: fullText, reasoningContent } = await consumeSseStream(
      response.body,
      callbacks.onChunk,
      abortSignal,
    );
    callbacks.onDone(fullText, false, reasoningContent);
  } catch (err: unknown) {
    if (abortSignal?.aborted) {
      // Abort is a normal lifecycle event (human interrupting a bot).
      // Do not log it as an error. onDone will be called by the caller
      // with whatever text was accumulated before the abort.
      return;
    }
    console.error("[llm-service] streamChatCompletion error:", err);
    callbacks.onChunk(fallbackText);
    callbacks.onDone(fallbackText, true);
  }
}

// ---------------------------------------------------------------------------
// Public API — non-streaming chat completion
// ---------------------------------------------------------------------------

/**
 * Perform a non-streaming OpenAI-compatible chat completion request.
 *
 * @param model       Model name
 * @param systemPrompt  System prompt text
 * @param userPrompt    User prompt text
 * @param fallbackText  Text to return if the LLM call fails.
 * @param disableThinking  Optional flag to disable model thinking (Moonshot API)
 * @returns The completion text, or fallbackText on failure.
 */
export async function completeChatCompletion(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  fallbackText: string,
  disableThinking?: boolean,
): Promise<{ text: string; wasFallback: boolean; reasoningContent?: string }> {
  const url = getChatCompletionsUrl();
  const body = buildRequestBody(model, systemPrompt, userPrompt, false, disableThinking);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(
        `[llm-service] completeChatCompletion HTTP ${response.status}: ${errorBody.slice(0, 500)}`,
      );
      return { text: fallbackText, wasFallback: true };
    }

    const data = await response.json() as Record<string, unknown>;
    const choices = Array.isArray(data.choices) ? (data.choices as Array<Record<string, unknown>>) : [];
    const firstChoice = choices[0] as Record<string, unknown> | undefined;
    const message = firstChoice?.message as Record<string, unknown> | undefined;
    const content: string | undefined = typeof message?.content === "string" ? message.content : undefined;
    const reasoningContent: string | undefined = typeof message?.reasoning_content === "string" ? message.reasoning_content : undefined;

    if (typeof content === "string" && content.length > 0) {
      return { text: content, wasFallback: false, reasoningContent };
    }

    console.error("[llm-service] completeChatCompletion: empty or missing content in response");
    return { text: fallbackText, wasFallback: true };
  } catch (err: unknown) {
    console.error("[llm-service] completeChatCompletion error:", err);
    return { text: fallbackText, wasFallback: true };
  }
}

// ---------------------------------------------------------------------------
// Convenience wrappers for the three call types
// ---------------------------------------------------------------------------

/**
 * Streaming completion for bot roleplay turns.
 * Uses ROLEPLAY_MODEL.
 */
export async function streamRoleplayCompletion(
  systemPrompt: string,
  userPrompt: string,
  callbacks: StreamCallbacks,
  abortSignal?: AbortSignal,
): Promise<void> {
  return streamChatCompletion(
    getModelForCallType("roleplay"),
    systemPrompt,
    userPrompt,
    callbacks,
    "[Bot failed to generate a response]",
    abortSignal,
    config.disableThinkingRoleplay,
  );
}

/**
 * Non-streaming completion for AI hint generation.
 * Uses HINT_MODEL.
 */
export async function completeHintCompletion(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ text: string; wasFallback: boolean; reasoningContent?: string }> {
  return completeChatCompletion(
    getModelForCallType("hint"),
    systemPrompt,
    userPrompt,
    "[Could not generate a hint at this time]",
    config.disableThinkingHint,
  );
}

/**
 * Streaming completion for summary evaluation.
 * Uses SUMMARY_MODEL.
 */
export async function streamSummaryCompletion(
  systemPrompt: string,
  userPrompt: string,
  callbacks: StreamCallbacks,
  abortSignal?: AbortSignal,
): Promise<void> {
  return streamChatCompletion(
    getModelForCallType("summary"),
    systemPrompt,
    userPrompt,
    callbacks,
    "[Could not generate evaluation]",
    abortSignal,
    config.disableThinkingSummary,
  );
}

// ---------------------------------------------------------------------------
// Service object export
// ---------------------------------------------------------------------------

export const LlmService = {
  getModelForCallType,
  streamChatCompletion,
  completeChatCompletion,
  streamRoleplayCompletion,
  completeHintCompletion,
  streamSummaryCompletion,
};

export default LlmService;
