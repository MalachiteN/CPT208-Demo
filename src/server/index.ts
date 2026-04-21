import { createApp } from "./app";
import { UserSessionStore } from "../stores/user-session-store";
import { RoomStore } from "../stores/room-store";
import { IdService } from "../services/id-service";
import { RoomService } from "../services/room-service";
import { DiscussionService } from "../services/discussion-service";
import { SummaryService } from "../services/summary-service";
import { BotService } from "../services/bot-service";
import { HintService } from "../services/hint-service";

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
    botService: BotService,
    hintService: HintService,
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
