/**
 * Shared TypeScript Models
 * 
 * Core types for the discussion rehearsal system.
 * Based on the contracts defined in docs/final-target-state.md
 */

// ============================================================================
// User Session
// ============================================================================

export interface UserSession {
  uuid: string;
  createdAt: number;
}

// ============================================================================
// Membership
// ============================================================================

export type MemberKind = "human" | "bot";

export interface Member {
  memberId: string;
  kind: MemberKind;
  displayName: string;
  userUuid?: string;           // Only for human members
  botProfile?: {               // Only for bot members
    name: string;
    persona: string;
  };
  isOwner: boolean;
  joinedAt: number;
}

// ============================================================================
// Room Phase
// ============================================================================

export type Phase = "lobby" | "discuss" | "summary";

// ============================================================================
// Discussion State
// ============================================================================

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

export interface PendingInterruption {
  fromMemberId: string;
  toMemberId: string;
  createdAt: number;
}

export interface DiscussionState {
  currentRound: number;
  currentSpeakerMemberId: string | null;
  currentSpeakerActive: boolean;
  roundSpokenMemberIds: string[];
  leaderMemberId: string | null;
  lastSpeakerMemberId: string | null;
  hasInterruptionOccurred: boolean;
  pendingInterruption: PendingInterruption | null;
  messages: ChatMessage[];
}

// ============================================================================
// Summary State
// ============================================================================

export interface FixedRubrics {
  everyoneSpoke: boolean | null;
  hasValidInterruption: boolean;
  leaderSameAsLastSpeaker: boolean | null;
  leaderMemberId: string | null;
}

export interface SummaryState {
  fixedRubrics: FixedRubrics;
  llmSummaryStatus: "idle" | "streaming" | "done";
  llmSummaryText: string;
  llmSummaryCursor: number;
}

// ============================================================================
// Room
// ============================================================================

export interface Room {
  roomId: string;
  ownerUuid: string;
  phase: Phase;
  members: Member[];
  createdAt: number;
  updatedAt: number;
  discussion?: DiscussionState;
  summary?: SummaryState;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  msg: string;
  data: T;
}

// ============================================================================
// Bot Streaming
// ============================================================================

export interface BotStreamContext {
  roomId: string;
  memberId: string;
  abortController: AbortController;
  isStreaming: boolean;
  accumulatedText: string;
}

// ============================================================================
// Service Result Types
// ============================================================================

export interface ServiceResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}
