/**
 * WebSocket Message Types
 * 
 * Defines all message types for the three websocket endpoints:
 * - /api/ws/setup (lobby phase)
 * - /api/ws/discuss (discussion phase)
 * - /api/ws/summary (summary phase)
 * 
 * Based on the contracts defined in docs/final-target-state.md
 */

// ============================================================================
// Base Types
// ============================================================================

export type Phase = "lobby" | "discuss" | "summary";

export type MemberKind = "human" | "bot";

export interface Member {
  memberId: string;
  kind: MemberKind;
  displayName: string;
  userUuid?: string;
  botProfile?: {
    name: string;
    persona: string;
  };
  isOwner: boolean;
  joinedAt: number;
}

export interface ChatMessage {
  messageId: string;
  type: "speech" | "system" | "bot_stream" | "bot_final";
  speakerMemberId: string | null;
  speakerDisplayName: string;
  text: string;
  createdAt: number;
  meta?: {
    interrupted?: boolean;
    round?: number;
    mock?: boolean;
  };
}

export interface DiscussionState {
  currentRound: number;
  currentSpeakerMemberId: string | null;
  currentSpeakerActive: boolean;
  roundSpokenMemberIds: string[];
  leaderMemberId: string | null;
  lastSpeakerMemberId: string | null;
  hasInterruptionOccurred: boolean;
  pendingInterruption: null | {
    fromMemberId: string;
    toMemberId: string;
    createdAt: number;
  };
  messages: ChatMessage[];
}

export { SummaryState } from "../models/types";

// ============================================================================
// Client -> Server Messages
// ============================================================================

// Common messages (used by all websockets)
export interface HelloMessage {
  type: "hello";
  uuid: string;
  roomId: string;
}

export interface PingMessage {
  type: "ping";
  ts: number;
}

// Setup phase messages (no additional client messages beyond hello/ping)

// Discuss phase messages
export interface StartSpeakingMessage {
  type: "start_speaking";
  data: {
    mediaPath?: string;
  };
}

export interface StopSpeakingMessage {
  type: "stop_speaking";
  data: {};
}

export interface NextSpeakerMessage {
  type: "next_speaker";
  data: {
    nextSpeakerMemberId: string;
  };
}

export interface InterruptRequestMessage {
  type: "interrupt_request";
  data: {
    targetSpeakerMemberId: string;
  };
}

export interface InterruptResponseMessage {
  type: "interrupt_response";
  data: {
    accepted: boolean;
  };
}

export interface AskHintMessage {
  type: "ask_hint";
}

// Summary phase messages (no additional client messages beyond hello/ping)

// Union type for all client messages
export type ClientMessage =
  | HelloMessage
  | PingMessage
  | StartSpeakingMessage
  | StopSpeakingMessage
  | NextSpeakerMessage
  | InterruptRequestMessage
  | InterruptResponseMessage
  | AskHintMessage;

// ============================================================================
// Server -> Client Messages
// ============================================================================

// Common messages
export interface PongMessage {
  type: "pong";
  ts: number;
}

export interface ErrorMessage {
  type: "error";
  data: {
    msg: string;
  };
}

// Setup phase messages
export interface RoomUpdateMessage {
  type: "room_update";
  data: {
    roomId: string;
    phase: Phase;
    members: Member[];
  };
}

export interface DiscussionStartedMessage {
  type: "discussion_started";
  data: {
    roomId: string;
    redirectTo: "/discuss";
  };
}

export interface RemovedFromRoomMessage {
  type: "removed_from_room";
  data: {
    roomId: string;
    redirectTo: "/setup";
  };
}

export interface RoomClosedMessage {
  type: "room_closed";
  data: {
    redirectTo: "/setup";
  };
}

// Discuss phase messages
export interface DiscussionStateMessage {
  type: "discussion_state";
  data: {
    roomId: string;
    phase: "discuss";
    currentRound: number;
    currentSpeakerMemberId: string | null;
    currentSpeakerActive: boolean;
    roundSpokenMemberIds: string[];
    leaderMemberId: string | null;
    lastSpeakerMemberId: string | null;
    hasInterruptionOccurred: boolean;
    pendingInterruption: DiscussionState["pendingInterruption"];
    messages: ChatMessage[];
    members: Member[];
  };
}

export interface SpeakerStartedMessage {
  type: "speaker_started";
  data: {
    memberId: string;
    displayName: string;
    mediaPath?: string;
  };
}

export interface SpeakerStoppedMessage {
  type: "speaker_stopped";
  data: {
    memberId: string;
  };
}

export interface MessageCreatedMessage {
  type: "message_created";
  data: {
    message: ChatMessage;
  };
}

export interface InterruptRequestedMessage {
  type: "interrupt_requested";
  data: {
    fromMemberId: string;
    fromDisplayName: string;
  };
}

export interface InterruptResolvedMessage {
  type: "interrupt_resolved";
  data: {
    accepted: boolean;
    fromMemberId: string;
    toMemberId: string;
  };
}

export interface HintMessage {
  type: "hint";
  data: {
    text: string;
    reasoningContent?: string;
  };
}

export interface HintStreamMessage {
  type: "hint_stream";
  data: {
    chunk: string;
    reasoningChunk?: string;
  };
}

export interface HintDoneMessage {
  type: "hint_done";
  data: {
    fullText: string;
    reasoningContent?: string;
  };
}

export interface BotStreamMessage {
  type: "bot_stream";
  data: {
    memberId: string;
    chunk: string;
  };
}

export interface BotDoneMessage {
  type: "bot_done";
  data: {
    memberId: string;
    fullText: string;
  };
}

export interface DiscussionEndedMessage {
  type: "discussion_ended";
  data: {
    roomId: string;
    redirectTo: "/summary";
  };
}

// Summary phase messages
export interface SummaryFixedMessage {
  type: "summary_fixed";
  data: {
    leaderMemberId: string | null;
    leaderSameAsLastSpeaker: boolean | null;
    everyoneSpoke: boolean | null;
    hasValidInterruption: boolean;
  };
}

export interface SummaryStreamMessage {
  type: "summary_stream";
  data: {
    chunk: string;
    reasoningContent?: string;
  };
}

export interface SummaryDoneMessage {
  type: "summary_done";
  data: {
    fullText: string;
    reasoningContent?: string;
  };
}

// Union type for all server messages
export type ServerMessage =
  | PongMessage
  | ErrorMessage
  | RoomUpdateMessage
  | DiscussionStartedMessage
  | RemovedFromRoomMessage
  | RoomClosedMessage
  | DiscussionStateMessage
  | SpeakerStartedMessage
  | SpeakerStoppedMessage
  | MessageCreatedMessage
  | InterruptRequestedMessage
  | InterruptResolvedMessage
  | HintMessage
  | HintStreamMessage
  | HintDoneMessage
  | BotStreamMessage
  | BotDoneMessage
  | DiscussionEndedMessage
  | SummaryFixedMessage
  | SummaryStreamMessage
  | SummaryDoneMessage;

// ============================================================================
// WebSocket Connection Metadata
// ============================================================================

export interface ConnectionMetadata {
  uuid: string;
  roomId: string;
  memberId: string;
  isAlive: boolean;
  connectedAt: number;
  lastPingAt: number;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isHelloMessage(msg: unknown): msg is HelloMessage {
  return typeof msg === "object" && msg !== null && (msg as Record<string, unknown>).type === "hello";
}

export function isPingMessage(msg: unknown): msg is PingMessage {
  return typeof msg === "object" && msg !== null && (msg as Record<string, unknown>).type === "ping";
}

export function isStartSpeakingMessage(msg: unknown): msg is StartSpeakingMessage {
  return typeof msg === "object" && msg !== null && (msg as Record<string, unknown>).type === "start_speaking";
}

export function isStopSpeakingMessage(msg: unknown): msg is StopSpeakingMessage {
  return typeof msg === "object" && msg !== null && (msg as Record<string, unknown>).type === "stop_speaking";
}

export function isNextSpeakerMessage(msg: unknown): msg is NextSpeakerMessage {
  return typeof msg === "object" && msg !== null && (msg as Record<string, unknown>).type === "next_speaker";
}

export function isInterruptRequestMessage(msg: unknown): msg is InterruptRequestMessage {
  return typeof msg === "object" && msg !== null && (msg as Record<string, unknown>).type === "interrupt_request";
}

export function isInterruptResponseMessage(msg: unknown): msg is InterruptResponseMessage {
  return typeof msg === "object" && msg !== null && (msg as Record<string, unknown>).type === "interrupt_response";
}

export function isAskHintMessage(msg: unknown): msg is AskHintMessage {
  return typeof msg === "object" && msg !== null && (msg as Record<string, unknown>).type === "ask_hint";
}
