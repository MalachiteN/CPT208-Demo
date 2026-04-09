import { UserSession } from "../models/types";

// In-memory store for user sessions
const sessions = new Map<string, UserSession>();

export function createSession(session: UserSession): void {
  sessions.set(session.uuid, session);
}

export function getSession(uuid: string): UserSession | undefined {
  return sessions.get(uuid);
}

export function hasSession(uuid: string): boolean {
  return sessions.has(uuid);
}

export function deleteSession(uuid: string): boolean {
  return sessions.delete(uuid);
}

export function getAllSessions(): UserSession[] {
  return Array.from(sessions.values());
}

// Cleanup old sessions (older than 24 hours)
export function cleanupOldSessions(): number {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  let deleted = 0;

  for (const [uuid, session] of sessions.entries()) {
    if (now - session.createdAt > maxAge) {
      sessions.delete(uuid);
      deleted++;
    }
  }

  return deleted;
}

export const UserSessionStore = {
  createSession,
  getSession,
  hasSession,
  deleteSession,
  getAllSessions,
  cleanupOldSessions,
};

export default UserSessionStore;
