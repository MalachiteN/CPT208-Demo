// ID generation service
// Provides consistent ID formats across the application

let uuidCounter = 0;
let roomCounter = 0;
let memberCounter = 0;
let messageCounter = 0;

export function generateUuid(): string {
  uuidCounter++;
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  const count = uuidCounter.toString(36);
  return `u_${timestamp}${random}${count}`;
}

export function generateRoomId(): string {
  roomCounter++;
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 5).toUpperCase();
  const count = roomCounter.toString().padStart(3, "0");
  return `R${count}${random}`;
}

export function generateMemberId(): string {
  memberCounter++;
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  const count = memberCounter.toString(36);
  return `m_${timestamp}${random}${count}`;
}

export function generateBotMemberId(): string {
  memberCounter++;
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  const count = memberCounter.toString(36);
  return `m_bot_${timestamp}${random}${count}`;
}

export function generateMessageId(): string {
  messageCounter++;
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  const count = messageCounter.toString(36);
  return `msg_${timestamp}${random}${count}`;
}

export const IdService = {
  generateUuid,
  generateRoomId,
  generateMemberId,
  generateBotMemberId,
  generateMessageId,
};

export default IdService;
