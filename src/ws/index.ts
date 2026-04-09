/**
 * WebSocket Module
 * 
 * Exports all WebSocket-related modules for easy importing.
 * 
 * Usage:
 *   import { connectionManager, messageTypes, setupWs, discussWs, summaryWs } from "./ws";
 */

export * as connectionManager from "./connection-manager";
export * as messageTypes from "./message-types";
export * as setupWs from "./setup-ws";
export * as discussWs from "./discuss-ws";
export * as summaryWs from "./summary-ws";

// Also export specific types that are commonly needed
export type {
  ConnectionMetadata,
  ClientMessage,
  ServerMessage,
  HelloMessage,
  PingMessage,
  StartSpeakingMessage,
  StopSpeakingMessage,
  InterruptRequestMessage,
  InterruptResponseMessage,
  AskHintMessage,
  PongMessage,
  ErrorMessage,
  RoomUpdateMessage,
  DiscussionStartedMessage,
  RemovedFromRoomMessage,
  RoomClosedMessage,
  DiscussionStateMessage,
  SpeakerStartedMessage,
  SpeakerStoppedMessage,
  MessageCreatedMessage,
  InterruptRequestedMessage,
  InterruptResolvedMessage,
  HintMessage,
  BotStreamMessage,
  BotDoneMessage,
  DiscussionEndedMessage,
  SummaryFixedMessage,
  SummaryStreamMessage,
  SummaryDoneMessage,
} from "./message-types";
