import { createApp } from "./app";
import { UserSessionStore } from "../stores/user-session-store";
import { RoomStore } from "../stores/room-store";
import { IdService } from "../services/id-service";
import { RoomService } from "../services/room-service";
import { DiscussionService } from "../services/discussion-service";
import { SummaryService } from "../services/summary-service";
import type { Member, Room } from "../models/types";

const botContexts = new Map<string, { abortController: AbortController }>();

const botService = {
  startBotTurn(room: Room, botMember: Member, onChunk: (chunk: string) => void, onDone: (fullText: string) => void) {
    const key = `${room.roomId}:${botMember.memberId}`;
    const abortController = new AbortController();
    botContexts.set(key, { abortController });
    const words = (`Hello everyone! As ${botMember.displayName}, I think we should discuss this carefully together.`).split(" ");
    let index = 0;
    let fullText = "";
    const timer = setInterval(() => {
      if (abortController.signal.aborted) {
        clearInterval(timer);
        botContexts.delete(key);
        return;
      }
      if (index >= words.length) {
        clearInterval(timer);
        botContexts.delete(key);
        onDone(fullText.trim());
        return;
      }
      const chunk = `${words[index]} `;
      fullText += chunk;
      onChunk(chunk);
      index += 1;
    }, 180);
  },
  interruptBot(roomId: string, memberId: string) {
    const key = `${roomId}:${memberId}`;
    const context = botContexts.get(key);
    if (context) {
      context.abortController.abort();
      botContexts.delete(key);
    }
  },
};

const hintService = {
  generateHint(room: Room, memberId: string) {
    const member = room.members.find((item) => item.memberId === memberId);
    return member ? `${member.displayName}, you may begin by clearly stating your main opinion.` : "You may begin by clearly stating your main opinion.";
  },
};

async function main() {
  const PORT = process.env.PORT || 3000;

  const stores = {
    userSessionStore: UserSessionStore,
    roomStore: RoomStore,
  };

  const services = {
    idService: IdService,
    roomService: RoomService,
    discussionService: DiscussionService,
    botService,
    hintService,
    summaryService: SummaryService,
  };

  const { server } = createApp(stores, services);
  server.listen(PORT, () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[Server] Fatal error:", error);
    process.exit(1);
  });
}

export { botService, hintService };
