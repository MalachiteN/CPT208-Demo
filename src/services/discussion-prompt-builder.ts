import type { ChatMessage, Member } from "../models/types";

/**
 * Discussion Prompt Builder
 *
 * Builds the shared discussion history template and appends
 * call-specific suffixes for roleplay, hint, and summary LLM calls.
 *
 * Template format (Stage 2 spec):
 *
 * 以下是本轮小组讨论当前的所有消息：
 *
 * XXX（displayName）：
 * 说话内容
 *
 * XXX（displayName）：
 * 说话内容
 *
 * Only messages of type "speech" and "bot_final" are included.
 * Messages are listed in chronological order (by createdAt ascending).
 */

// ---------------------------------------------------------------------------
// Shared history template
// ---------------------------------------------------------------------------

/**
 * Returns the set of message types considered substantive for prompt assembly.
 * System messages and partial bot_stream rows are excluded.
 */
function isSubstantiveMessage(msg: ChatMessage): boolean {
  return msg.type === "speech" || msg.type === "bot_final";
}

/**
 * Build the shared discussion history template from discussion messages.
 *
 * If no substantive messages exist yet, returns just the header line.
 */
export function buildHistoryTemplate(messages: ChatMessage[]): string {
  const lines: string[] = ["以下是本轮小组讨论当前的所有消息：", ""];

  const substantive = messages
    .filter(isSubstantiveMessage)
    .sort((a, b) => a.createdAt - b.createdAt);

  if (substantive.length === 0) {
    return lines.join("\n");
  }

  for (const msg of substantive) {
    lines.push(`${msg.speakerDisplayName}：`);
    lines.push(msg.text);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Roleplay prompt assembly
// ---------------------------------------------------------------------------

export interface RoleplayPromptParams {
  messages: ChatMessage[];
  botDisplayName: string;
  botPersona: string;
}

/**
 * Assemble the full user prompt for a bot roleplay call.
 *
 * [shared history]
 * 你的名字是：{bot.displayName}
 * 你的角色设定：{bot.botProfile.persona}
 *
 * 请仅给出本轮你的发言：
 */
export function buildRoleplayUserPrompt(params: RoleplayPromptParams): string {
  const history = buildHistoryTemplate(params.messages);
  const parts: string[] = [
    history,
    `你的名字是：${params.botDisplayName}`,
    `你的角色设定：${params.botPersona}`,
    "",
    "请仅给出本轮你的发言：",
  ];
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Hint prompt assembly
// ---------------------------------------------------------------------------

export interface HintPromptParams {
  messages: ChatMessage[];
  userDisplayName: string;
}

/**
 * Assemble the full user prompt for an AI hint call.
 *
 * [shared history]
 * 请针对当前发言的 XXX 同学，给出一组恰当的提纲性发言建议：
 */
export function buildHintUserPrompt(params: HintPromptParams): string {
  const history = buildHistoryTemplate(params.messages);
  const parts: string[] = [
    history,
    `请针对当前发言的 ${params.userDisplayName} 同学，给出一组恰当的提纲性发言建议：`,
  ];
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Summary prompt assembly
// ---------------------------------------------------------------------------

export interface SummaryPromptParams {
  messages: ChatMessage[];
}

const SUMMARY_RUBRIC_SUFFIX = `现在这场小组讨论已经结束了。评价一场小组讨论的标准为：
- 首次发言是否起到了总起和引入话题的作用
- 末次发言是否起到了总结收束的作用
- 每个人的初始观点是什么，讨论过程中观点是否发生了偏移以达成共识
- 讨论是否偏离主题
- 是否有合理的打断
- 所有人是否都参与了发言

请对本次讨论给出你的评价：`;

/**
 * Assemble the full user prompt for a summary evaluation call.
 *
 * [shared history]
 * 现在这场小组讨论已经结束了。评价一场小组讨论的标准为：……
 * 请对本次讨论给出你的评价：
 */
export function buildSummaryUserPrompt(params: SummaryPromptParams): string {
  const history = buildHistoryTemplate(params.messages);
  const parts: string[] = [
    history,
    SUMMARY_RUBRIC_SUFFIX,
  ];
  return parts.join("\n");
}

export const DiscussionPromptBuilder = {
  buildHistoryTemplate,
  buildRoleplayUserPrompt,
  buildHintUserPrompt,
  buildSummaryUserPrompt,
};

export default DiscussionPromptBuilder;
