# Final Target State Document

## 1. Document Purpose

This document is the authoritative final target state for the current milestone of the project.

It defines the intended low-fidelity prototype scope for a TypeScript + Node.js + Express web server that demonstrates the XJTLU small-group discussion workflow through page layout, page transitions, room state management, and websocket-driven orchestration.

This document is the single source of truth for downstream planning, implementation, and review.

If implementation later reveals gaps or contradictions, this document must be revised explicitly rather than worked around informally.

---

## 2. Product Goal

The product is a web-based discussion rehearsal environment oriented toward:

- classroom small-group discussion teaching
- oral discussion practice
- XJTLU group discussion exam rehearsal
- students who are unwilling to speak in class
- students who do not want to proactively organize practice with teammates before the exam
- fully remote, AI-assisted practice scenarios

The long-term vision is a room in which any number of human users and any number of AI bots can take turns speaking, where:

- whisper-based speech transcription can be integrated
- mediaMTX-based audio streaming can be integrated
- LLM generation can be interrupted
- human speech turns can also be interrupted according to exam rules
- AI can suggest what a student may say when it is their turn and they do not know how to begin
- after discussion, AI + deterministic rule logic can score rubric-oriented discussion quality

However, **the current milestone does not implement real AI, real transcription, or real audio streaming**.

The current milestone only implements a **low-fidelity but structurally correct prototype** whose job is to:

- provide the page flow
- provide visual layout
- provide room and member state management
- provide room lifecycle management
- provide websocket-driven phase transition behavior
- provide a lightweight discussion state machine sufficient to drive UI logic
- provide mock placeholders and protocol surfaces that future versions can swap to real AI / whisper / mediamtx integration with minimal redesign

---

## 3. In-Scope vs Out-of-Scope

### 3.1 In Scope

The current milestone includes:

1. A Node.js + Express server written in TypeScript.
2. Static frontend pages served by the backend.
3. Frontend implemented as plain static HTML/CSS/JavaScript.
4. Four visible user pages:
   - `/setup`
   - `/create`
   - `/discuss`
   - `/summary`
5. JSON POST APIs for room and membership management.
6. Three websocket endpoints:
   - `/api/ws/setup`
   - `/api/ws/discuss`
   - `/api/ws/summary`
7. In-memory state management for:
   - anonymous one-time users
   - rooms
   - room members
   - room phase
   - lightweight discussion state
   - lightweight summary state
8. Owner-driven room creation.
9. Human user room joining.
10. Owner-driven LLM bot member creation and removal.
11. Owner-driven member removal.
12. Owner-driven transition from room setup phase into discussion phase.
13. Owner-driven transition from discussion phase into summary phase.
14. Websocket-driven page redirection triggers for non-owner members.
15. Mock discussion state transitions sufficient for demonstrating:
   - current speaker
   - start speaking
   - stop speaking
   - next speaker selection
   - round tracking
   - interrupt request
   - interrupt accept/reject for human speaker
   - mock bot text streaming
   - mock AI hint button behavior
16. Summary page display with:
   - deterministic rubric placeholders/state-machine-derived results
   - mock evaluator LLM summary text streaming placeholder behavior
17. `docker-compose.yml` including:
   - this backend service
   - a whisper.cpp server container placeholder
   - a mediamtx container placeholder
18. Dockerfile for packaging the backend service.
19. Explicit refresh/re-entry handling through `POST /api/room/state` and phase-aware frontend recovery logic.
20. A split lobby experience in which:
   - the owner uses `/create` as the room-management lobby page
   - joined non-owner users remain on `/setup` in a joined-lobby waiting state that still receives live lobby updates through `/api/ws/setup`

### 3.2 Explicitly Out of Scope

The current milestone does **not** implement:

1. Real OpenAI-compatible LLM calls.
2. Real whisper.cpp API calls.
3. Real mediaMTX streaming control.
4. Real microphone capture transport to mediaMTX.
5. Real speech transcription.
6. Real audio relay or playback logic.
7. Real persistent storage/database.
8. Real authentication.
9. Real account systems.
10. Real mobile-responsive optimization.
11. Advanced styling polish beyond clear low-fidelity demonstration quality.
12. Complex production-grade fault tolerance.
13. Real rubric evaluation by AI.
14. Real consensus/stance analysis.
15. Real leader evaluation semantics.
16. Full business logic correctness for all future grading rules.

### 3.3 Important Boundary Decision

This version **does include a lightweight discussion state machine** even though it does not implement real AI/audio/transcription. This is intentional and required, because UI button enablement, round logic, interrupt behavior, and page demonstration all depend on basic state transitions.

---

## 4. UX and Interaction Philosophy

The frontend is intentionally low-fidelity and practical.

It should feel like:

- a clean classroom demo tool
- easy to understand during presentation
- not visually overloaded
- not dependent on modern chat app conventions

The product should prioritize:

- structural correctness of workflow
- clarity of transitions
- explicit visible state
- easy future replacement of mock logic with real implementations

The implementation should avoid:

- TSX-heavy complexity
- framework-heavy frontend architecture
- over-abstracted UI systems

The selected frontend direction is:

- static pages
- frontend JavaScript
- native DOM manipulation
- websocket-driven updates
- modal dialogs/popups implemented with ordinary JS and HTML/CSS

---

## 5. Page-Level Requirements

## 5.1 `/setup`

### Purpose

Anonymous onboarding, room joining entry point, and joined non-owner lobby waiting page.

### Required Behavior

The `/setup` page has **two modes**.

#### Mode A: fresh anonymous setup mode

1. When a user visits `/setup` without an active joined-room waiting context, frontend should call `POST /api/setup` to request a new one-time UUID.
2. The page must display the assigned UUID in large text.
3. The page must allow a user to input a room ID.
4. The page must have a button to join a room.
5. The page must have a button to create a room.
6. If the user chooses to create a room, frontend should call `/api/create` using the current UUID, then navigate to `/create`.
7. If the user chooses to join a room, frontend should call `/api/adduser`.

#### Mode B: joined non-owner lobby waiting mode

After a non-owner user successfully joins a room during lobby phase:

1. The user remains on `/setup` rather than navigating to `/create`.
2. Frontend connects to `/api/ws/setup` for that room.
3. The page must visibly show that the user has already joined a room and is waiting in the lobby.
4. In this mode the page must display at least:
   - current UUID
   - joined roomId
   - a live member list for the room
   - a waiting-status indication that discussion has not started yet
5. In this mode the page must react to setup websocket messages for:
   - room member changes
   - discussion start redirect into `/discuss`
   - removal from room redirect back to fresh setup mode
   - room closure redirect back to fresh setup mode
6. In this mode the page must **not automatically mint a new UUID on every render**, because the user is still the same joined room participant.

### Refresh and Re-entry Rules for `/setup`

Because `/setup` carries both fresh-setup and joined-lobby semantics, frontend must decide the mode explicitly.

#### Fresh visit / reset visit

If the user is not currently in an active joined-lobby waiting state:
- `/setup` should request a new UUID from `/api/setup`

#### Joined-lobby re-entry / refresh

If local browser state indicates that:
- the user has a `uuid`
- the user has a `roomId`
- the room phase may still be `lobby`
- the user is not the owner

then frontend should first call `POST /api/room/state` to determine whether the user is still in a valid joined-lobby state before deciding to mint a new UUID.

If `/api/room/state` confirms the room is still in `lobby` and the user is still a human member of that room:
- stay in joined non-owner lobby waiting mode
- reconnect `/api/ws/setup`
- do not mint a new UUID

If `/api/room/state` does not confirm a valid joined-lobby state:
- clear room-local waiting state
- fall back to fresh anonymous setup mode
- call `/api/setup` for a new UUID

### Required UI Elements

In fresh anonymous setup mode:
- large UUID display label
- room ID input box
- join room button
- create room button

In joined non-owner lobby waiting mode:
- large UUID display label
- joined roomId display label
- live member list
- waiting status label
- optionally a leave/reset style control if later desired, but not required for this milestone

### Important Clarification

The earlier contradiction has been resolved as follows:
- `/setup` supports both anonymous setup and room joining
- after join, non-owner users remain on `/setup` in a joined-lobby waiting state
- `/create` remains the owner’s room-management lobby page

---

## 5.2 `/create`

### Purpose

Owner-only lobby/setup room management page.

### Required Behavior

1. The owner enters this page after successful room creation.
2. Room creation automatically adds the owner as the first human member of the room.
3. The owner remains logically in the setup/lobby phase and uses `/api/ws/setup` while on this page.
4. The page must show the room ID prominently.
5. The page must show a current member list.
6. Member list entries must include:
   - display name
   - whether it is human or bot
   - owner marking where applicable
   - remove button
7. The owner may add a bot by entering:
   - bot name
   - bot personality / persona natural-language description
8. The owner may remove a member.
9. The owner may click “start discussion”.
10. When discussion starts:
    - the owner frontend navigates itself into `/discuss`
    - the server pushes a discussion-start event via `/api/ws/setup` to other human room members
    - those members are redirected into `/discuss`
11. Non-owner users should not be treated as normal `/create` users in the intended page model. If a non-owner user lands on `/create` during refresh recovery or stale navigation, frontend should recover by consulting room state and redirecting appropriately rather than silently reusing `/create` as a shared lobby page.

### Required UI Elements

- large room ID display label
- member list
- input for AI/bot name
- input for AI/bot personality/persona
- add AI button
- start discussion button

### Styling Notes

- layout should be vertical and clear
- inputs should avoid ugly scrollbars
- if multiline input is used for persona, it should auto-size or be styled to hide unnecessary scroll appearance

---

## 5.3 `/discuss`

### Purpose

Low-fidelity chat-style discussion page that demonstrates turn-taking and interruption structure.

### Required Behavior

1. On entering `/discuss`, the frontend must close `/api/ws/setup` and connect to `/api/ws/discuss`.
2. The page must display the current speaker in the top bar.
3. The page must display a scrollable message history.
4. All message rows are left-aligned.
5. Message rows should display the speaker display name at left.
6. Text content is shown plainly; no need for “my messages on the right” modern IM behavior.
7. The bottom of the page must contain exactly three main controls:
   - speech input button
   - interrupt current speaker button
   - AI hint button
8. The speech input button toggles between:
   - start speech input
   - end speech input
9. After the active speaker ends speaking, a modal/popup must appear for selecting the next speaker from members who have not yet spoken in the current round.
10. If the current speaker receives an interruption request and is human, a very prominent accept/reject modal must appear.
11. The owner must see an “end discussion” button in the upper-right corner.
12. Ending discussion must require modal confirmation.
13. The UI must support mock state-driven behavior for:
   - start speaking
   - stop speaking
   - next speaker assignment
   - round progression
   - interrupt request
   - interrupt acceptance/rejection
   - bot turn mock streaming text generation
   - bot interruption by human
14. If the assigned next speaker is a bot, the server mock logic may emit bot streaming text over websocket rather than any real voice behavior.
15. The page should be as simple as possible while still demonstrating the required workflow.
16. Bot streaming must be visibly rendered on the discuss page, not merely logged in console. A mock partial row or equivalent placeholder rendering is sufficient as long as users can see streamed bot participation.

### Button Enablement Rules

#### Speech Input Button

- enabled only when the current user is the assigned current speaker
- starts as “start speaking” when assigned and not speaking
- changes to “end speaking” once started
- disabled for non-current-speaker users

#### Interrupt Button

- enabled only if:
  - someone else is currently speaking
  - the current user is human
  - the current user has not yet spoken in the current round
- otherwise disabled/greyed out

#### AI Hint Button

- enabled only if:
  - the current user is the assigned current speaker
  - the current user has not yet started speaking
- disabled in all other cases

### First-Speaker Rule for This Milestone

To keep the low-fidelity prototype internally consistent without adding a dedicated pre-discussion speaker-assignment API, the server may allow the first valid `start_speaking` request in a discussion whose `currentSpeakerMemberId` is still `null` to atomically claim the first speaker role.

If this rule is used:
- it must be enforced server-side, not faked only in frontend local state
- after that point, normal “assigned current speaker only” rules apply
- frontend button states should still reflect the authoritative server state as soon as it is known

This is the approved milestone-level branch behavior for first-speaker bootstrapping.

### Refresh and Re-entry Rules for `/discuss`

If a user refreshes or re-enters `/discuss`:

1. Frontend must use `POST /api/room/state` as authoritative source of phase and room membership.
2. Frontend must not assume local `memberId` is always present or still correct.
3. If local `memberId` is missing but `uuid` and `roomId` still exist, frontend should recover `memberId` by matching the current user’s `uuid` against the returned room members.
4. If room phase is:
   - `discuss`: remain on `/discuss`, restore local phase/member identity, and connect `/api/ws/discuss`
   - `lobby`: redirect according to role
     - owner -> `/create`
     - non-owner -> `/setup`
   - `summary`: redirect to `/summary`
5. If rehydration fails, frontend may clear stale room state and fall back to `/setup`.

### Required UI Elements

- top bar with current speaker
- owner-only end discussion button in top-right
- scrollable message history area
- bottom fixed control bar with three buttons
- modal for next-speaker selection
- modal for interrupt accept/reject
- modal for discussion end confirmation

### Important Scope Boundary

This version does **not** perform real microphone transport, real transcription, or real LLM generation. It only demonstrates the state transitions and websocket/UI contracts.

---

## 5.4 `/summary`

### Purpose

Display deterministic rubric state and mock evaluator output after discussion ends.

### Required Behavior

1. On entering `/summary`, frontend must close `/api/ws/discuss` and connect to `/api/ws/summary`.
2. The page must display rubric achievement status using emoji at the top.
3. Deterministic/state-machine-derived summary facts should appear quickly and directly.
4. Mock evaluator LLM summary text should appear in a label/text display area and may be streamed over websocket.
5. There must be a reset button returning the user to `/setup`.
6. Resetting does not call a dedicated reset API; instead it returns to `/setup`, and `/setup` requests a new UUID from `/api/setup` unless the frontend is deliberately preserving a valid joined-lobby waiting context under the `/setup` dual-mode rules.

### Refresh and Re-entry Rules for `/summary`

If a user refreshes or re-enters `/summary`:

1. Frontend must call `POST /api/room/state`.
2. If room phase is:
   - `summary`: remain and reconnect `/api/ws/summary`
   - `discuss`: redirect to `/discuss`
   - `lobby`: redirect according to role
     - owner -> `/create`
     - non-owner -> `/setup`
3. If rehydration fails, frontend may fall back to `/setup` and request a new UUID under the `/setup` mode rules.

### Required UI Elements

- top emoji-based rubric summary strip
- fixed rubric result display area
- summary text box/label area for evaluator output
- reset button

---

## 6. Phase Model

A room has exactly one current phase.

```ts
phase: "lobby" | "discuss" | "summary"
```

### Phase Semantics

#### `lobby`

- room exists
- owner can add/remove bot members
- humans can join
- owner can remove members
- owner can start discussion
- frontend socket endpoint in use: `/api/ws/setup`
- owner’s intended page: `/create`
- joined non-owner user’s intended page: `/setup` in joined-lobby waiting mode

#### `discuss`

- room has moved into discussion state
- humans in room should be on `/discuss`
- frontend socket endpoint in use: `/api/ws/discuss`
- lightweight discussion state machine becomes active

#### `summary`

- discussion has ended
- humans should be on `/summary`
- frontend socket endpoint in use: `/api/ws/summary`
- fixed rubrics and mock evaluator output can be displayed
- room becomes eligible for auto-destruction once all human summary websocket heartbeats disappear for timeout duration

---

## 7. Identity and Membership Model

## 7.1 User Session

The system uses anonymous one-time user IDs.

```ts
type UserSession = {
  uuid: string;
  createdAt: number;
}
```

### Rules

1. `/api/setup` creates a new UUID when the frontend decides it is in fresh anonymous setup mode.
2. There is no persistent account identity.
3. Re-entering `/setup` in fresh mode means requesting a new UUID.
4. No dedicated reset API exists.
5. Re-entering `/setup` while preserving a valid joined non-owner lobby waiting context is a special case governed by the dual-mode `/setup` rules, not by persistent identity semantics.

---

## 7.2 Room Member Model

All room participants are unified under a single member abstraction.

```ts
type Member = {
  memberId: string;
  kind: "human" | "bot";
  displayName: string;
  userUuid?: string;
  botProfile?: {
    name: string;
    persona: string;
  };
  isOwner: boolean;
  joinedAt: number;
}
```

### Rules

1. Internal room operations use `memberId` consistently.
2. UI may display human UUIDs and bot names, but backend protocol references should use `memberId` wherever membership identity is needed.
3. Human members have:
   - `kind: "human"`
   - `userUuid`
   - `displayName` typically equal to `uuid`
4. Bot members have:
   - `kind: "bot"`
   - `botProfile`
   - `displayName` typically equal to bot name
5. Exactly one owner exists per room.
6. Owner is always a human member.
7. Room creation automatically inserts the owner as the first room member.

---

## 8. Room State Model

```ts
type Room = {
  roomId: string;
  ownerUuid: string;
  phase: "lobby" | "discuss" | "summary";
  members: Member[];
  createdAt: number;
  updatedAt: number;
  discussion?: DiscussionState;
  summary?: SummaryState;
}
```

### Rules

1. `roomId` is generated by backend when owner creates a room.
2. `ownerUuid` identifies the human who created the room.
3. `members` includes both humans and bots.
4. The room store is in-memory for this milestone.
5. Room state is destroyed after summary when all human summary websocket connections are gone for the timeout period.

---

## 9. Discussion State Model

A lightweight but explicit discussion state machine is in scope.

```ts
type DiscussionState = {
  currentRound: number;
  currentSpeakerMemberId: string | null;
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
```

### Field Semantics

#### `currentRound`
Current discussion round number, starting from `1`.

#### `currentSpeakerMemberId`
The member who is currently assigned/actively speaking.

#### `roundSpokenMemberIds`
Members who have already spoken in the current round.

#### `leaderMemberId`
The first speaker of the whole discussion. This is tracked deterministically so it can later feed summary logic.

#### `lastSpeakerMemberId`
The most recent speaker who finished a turn. This is tracked to support the later rubric checking that compares first and last speaker.

#### `hasInterruptionOccurred`
Becomes `true` if any interruption is accepted during the discussion.

#### `pendingInterruption`
Tracks a currently active interruption request toward a human speaker.

#### `messages`
Chat history / discussion event log used by the discuss UI.

---

## 10. Summary State Model

```ts
type SummaryState = {
  fixedRubrics: {
    everyoneSpoke: boolean | null;
    hasValidInterruption: boolean;
    leaderSameAsLastSpeaker: boolean | null;
    leaderMemberId: string | null;
  };
  llmSummaryStatus: "idle" | "streaming" | "done";
  llmSummaryText: string;
  llmSummaryCursor?: number;
}
```

### Notes

This version does not produce a real evaluator analysis. However, it must preserve a structure that later lets deterministic rubric outputs and LLM-generated evaluative outputs coexist.

### Fixed Rubrics in This Milestone

At minimum the deterministic summary state should support:

- whether everyone spoke
- whether at least one accepted interruption happened
- who the leader is by first-speaker rule
- whether first speaker and last speaker are the same member

These are not the full final rubric semantics, but they create the structural placeholder required for future implementation.

### Streaming Cursor Requirement

If mock summary streaming is chunked across websocket messages, the implementation should track explicit stream progression state such as `llmSummaryCursor` or an equivalent cursor field rather than inferring progress from accumulated string length.

---

## 11. Message Model

```ts
type ChatMessage = {
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
```

### Purpose

This message model supports:

- human mock transcript rows
- system event notices
- bot streaming placeholders
- future replacement with real transcript and LLM output

---

## 12. API Design Rules

## 12.1 Global Rules for Non-WebSocket APIs

1. Every non-websocket endpoint uses `POST`.
2. Every non-websocket endpoint receives JSON.
3. Every non-websocket endpoint returns JSON in this unified format:

```json
{
  "success": true,
  "msg": "string",
  "data": {}
}
```

4. On failure, the same shape is used with `success: false`.
5. Validation failure, authorization failure, phase mismatch, and missing room/member/user should all return this shape with explanatory `msg`.
6. Frontend API utilities should preserve this structured response shape even for non-2xx HTTP status codes whenever the backend provided such a JSON body.

---

## 13. HTTP API Final Design

## 13.1 `POST /api/setup`

### Purpose

Create a new one-time anonymous UUID.

### Request

```json
{}
```

### Response

```json
{
  "success": true,
  "msg": "UUID created",
  "data": {
    "uuid": "u_xxxxx"
  }
}
```

### Notes

- creates a new UUID when called
- frontend should call this when entering fresh anonymous setup mode
- frontend should not call this while deliberately preserving a valid joined-lobby waiting context on `/setup`

---

## 13.2 `POST /api/create`

### Purpose

Create a room and automatically add the requesting user as owner and first human member.

### Request

```json
{
  "uuid": "u_xxxxx"
}
```

### Response

```json
{
  "success": true,
  "msg": "Room created",
  "data": {
    "roomId": "R12345",
    "ownerUuid": "u_xxxxx",
    "phase": "lobby",
    "members": [
      {
        "memberId": "m_xxx",
        "kind": "human",
        "displayName": "u_xxxxx",
        "userUuid": "u_xxxxx",
        "isOwner": true
      }
    ]
  }
}
```

### Rules

- user must already have a UUID
- owner is auto-added to room
- owner then navigates to `/create`
- owner remains on setup websocket channel until discuss begins

---

## 13.3 `POST /api/adduser`

### Purpose

Join an existing room as a human member.

### Request

```json
{
  "uuid": "u_xxxxx",
  "roomId": "R12345"
}
```

### Response

```json
{
  "success": true,
  "msg": "Joined room",
  "data": {
    "roomId": "R12345",
    "phase": "lobby",
    "member": {
      "memberId": "m_xxx",
      "kind": "human",
      "displayName": "u_xxxxx",
      "userUuid": "u_xxxxx",
      "isOwner": false
    },
    "members": []
  }
}
```

### Rules

- only allowed while room phase is `lobby`
- user becomes a human member of room
- after success, non-owner frontend remains on `/setup` in joined-lobby waiting mode and connects `/api/ws/setup`
- if room does not exist or is not in joinable phase, fail gracefully

---

## 13.4 `POST /api/addbot`

### Purpose

Owner adds a mock LLM bot member to the room.

### Request

```json
{
  "uuid": "owner_uuid",
  "roomId": "R12345",
  "botName": "AliceBot",
  "persona": "偏向领导者，英语水平一般"
}
```

### Response

```json
{
  "success": true,
  "msg": "Bot added",
  "data": {
    "roomId": "R12345",
    "member": {
      "memberId": "m_bot_xxx",
      "kind": "bot",
      "displayName": "AliceBot",
      "botProfile": {
        "name": "AliceBot",
        "persona": "偏向领导者，英语水平一般"
      },
      "isOwner": false
    },
    "members": []
  }
}
```

### Rules

- only owner may add bot
- only allowed during `lobby`
- should update room member list for all setup websocket subscribers
- this version only stores the bot definition; no real AI runtime is attached

---

## 13.5 `POST /api/remove`

### Purpose

Owner removes a member from the room.

### Request

```json
{
  "uuid": "owner_uuid",
  "roomId": "R12345",
  "memberId": "m_xxx"
}
```

### Response

```json
{
  "success": true,
  "msg": "Member removed",
  "data": {
    "roomId": "R12345",
    "members": []
  }
}
```

### Rules

- only owner may remove members
- allowed during `lobby`
- if removed member is human and connected on setup websocket, they should receive `removed_from_room`
- owner removal of self is forbidden in this milestone

---

## 13.6 `POST /api/start`

### Purpose

Owner starts the discussion and transitions room from `lobby` to `discuss`.

### Request

```json
{
  "uuid": "owner_uuid",
  "roomId": "R12345"
}
```

### Response

```json
{
  "success": true,
  "msg": "Discussion started",
  "data": {
    "roomId": "R12345",
    "phase": "discuss"
  }
}
```

### Rules

- only owner may call this
- only allowed in `lobby`
- initializes discussion state
- owner frontend navigates itself to `/discuss`
- server notifies all other human room members through `/api/ws/setup`
- clients receiving the event navigate to `/discuss`

---

## 13.7 `POST /api/end`

### Purpose

Owner ends the discussion and transitions room from `discuss` to `summary`.

### Request

```json
{
  "uuid": "owner_uuid",
  "roomId": "R12345"
}
```

### Response

```json
{
  "success": true,
  "msg": "Discussion ended",
  "data": {
    "roomId": "R12345",
    "phase": "summary"
  }
}
```

### Rules

- only owner may call this
- only allowed in `discuss`
- computes or initializes fixed summary rubric state
- initializes mock summary stream state if needed
- owner navigates to `/summary`
- server pushes `/summary` redirect event to all others through `/api/ws/discuss`

---

## 13.8 `POST /api/room/state`

### Purpose

Allow frontend to recover current room state after refresh or page re-entry.

### Request

```json
{
  "uuid": "u_xxxxx",
  "roomId": "R12345"
}
```

### Response

The response should provide the room’s current phase and enough state to rehydrate the appropriate page.

Example shape:

```json
{
  "success": true,
  "msg": "Room state fetched",
  "data": {
    "roomId": "R12345",
    "phase": "discuss",
    "ownerUuid": "u_owner",
    "members": [],
    "discussion": {
      "currentRound": 1,
      "currentSpeakerMemberId": "m_xxx",
      "roundSpokenMemberIds": []
    },
    "summary": null
  }
}
```

### Rules

- intended for page refresh resilience
- available in all phases for room members
- frontend can use phase to decide whether to redirect/reload proper page
- frontend may also use returned `members` to recover a missing local `memberId` by matching against the current user’s `uuid`

---

## 14. WebSocket Design Rules

## 14.1 Global Rules

1. There are three distinct websocket endpoints:
   - `/api/ws/setup`
   - `/api/ws/discuss`
   - `/api/ws/summary`
2. Clients should close the old phase websocket before opening the new phase websocket during page transition.
3. Websocket handshake may use query parameters for `uuid` and `roomId`.
4. Each websocket should validate:
   - UUID exists
   - room exists
   - user belongs to room as human member
   - room phase matches endpoint purpose where applicable
5. Bots do not hold frontend connections and do not send heartbeats.
6. Heartbeats are required for human websocket lifecycle tracking.
7. Heartbeat and liveness tracking should be phase/connection-specific rather than globally conflated across phases.

---

## 15. `/api/ws/setup` Protocol

### Purpose

Used during lobby/setup phase.

### Client -> Server Messages

#### hello

```json
{
  "type": "hello",
  "uuid": "u_xxx",
  "roomId": "R12345"
}
```

#### ping

```json
{
  "type": "ping",
  "ts": 123456789
}
```

### Server -> Client Messages

#### room_update

```json
{
  "type": "room_update",
  "data": {
    "roomId": "R12345",
    "phase": "lobby",
    "members": []
  }
}
```

#### discussion_started

```json
{
  "type": "discussion_started",
  "data": {
    "roomId": "R12345",
    "redirectTo": "/discuss"
  }
}
```

#### removed_from_room

```json
{
  "type": "removed_from_room",
  "data": {
    "roomId": "R12345",
    "redirectTo": "/setup"
  }
}
```

#### room_closed

```json
{
  "type": "room_closed",
  "data": {
    "redirectTo": "/setup"
  }
}
```

#### pong

```json
{
  "type": "pong",
  "ts": 123456789
}
```

### Responsibilities

- keep room member list live during lobby
- support both owner `/create` and non-owner `/setup` joined-lobby waiting mode
- notify non-owner users to enter discuss when owner starts discussion
- notify removed users to go back to fresh setup mode

---

## 16. `/api/ws/discuss` Protocol

### Purpose

Used during discussion phase.

### Important Scope Note

This protocol must be designed for future real audio/AI integration, but current behavior may be mock-driven.

### Client -> Server Messages

#### hello

```json
{
  "type": "hello",
  "uuid": "u_xxx",
  "roomId": "R12345"
}
```

#### start_speaking

```json
{
  "type": "start_speaking",
  "data": {
    "mediaPath": "placeholder-or-future-stream-path"
  }
}
```

### Current Meaning

- in this milestone, this does not actually establish real streaming
- it changes discussion state to indicate active speaking
- future versions will map this to mediaMTX setup behavior

#### stop_speaking

```json
{
  "type": "stop_speaking",
  "data": {
    "nextSpeakerMemberId": "m_xxx"
  }
}
```

### Current Meaning

- in this milestone, this ends a mock speaking turn
- creates a mock transcript/message entry
- marks the speaker as having spoken in current round
- assigns next speaker

#### interrupt_request

```json
{
  "type": "interrupt_request",
  "data": {
    "targetSpeakerMemberId": "m_xxx"
  }
}
```

#### interrupt_response

```json
{
  "type": "interrupt_response",
  "data": {
    "accepted": true
  }
}
```

#### ask_hint

```json
{
  "type": "ask_hint"
}
```

### Current Meaning

- current version may return mock hint text
- future versions will call an actual LLM advisor

#### ping

```json
{
  "type": "ping",
  "ts": 123
}
```

### Server -> Client Messages

#### discussion_state

```json
{
  "type": "discussion_state",
  "data": {
    "roomId": "R12345",
    "phase": "discuss",
    "currentRound": 1,
    "currentSpeakerMemberId": "m_xxx",
    "roundSpokenMemberIds": [],
    "members": []
  }
}
```

#### speaker_started

```json
{
  "type": "speaker_started",
  "data": {
    "memberId": "m_xxx",
    "displayName": "u_123",
    "mediaPath": "/future/path"
  }
}
```

#### speaker_stopped

```json
{
  "type": "speaker_stopped",
  "data": {
    "memberId": "m_xxx"
  }
}
```

#### message_created

```json
{
  "type": "message_created",
  "data": {
    "message": {}
  }
}
```

#### interrupt_requested

```json
{
  "type": "interrupt_requested",
  "data": {
    "fromMemberId": "m_xxx",
    "fromDisplayName": "u_456"
  }
}
```

#### interrupt_resolved

```json
{
  "type": "interrupt_resolved",
  "data": {
    "accepted": true,
    "fromMemberId": "m_xxx",
    "toMemberId": "m_yyy"
  }
}
```

#### hint

```json
{
  "type": "hint",
  "data": {
    "text": "You may begin by stating your view..."
  }
}
```

#### bot_stream

```json
{
  "type": "bot_stream",
  "data": {
    "memberId": "m_bot_xxx",
    "chunk": "..."
  }
}
```

#### bot_done

```json
{
  "type": "bot_done",
  "data": {
    "memberId": "m_bot_xxx",
    "fullText": "..."
  }
}
```

#### discussion_ended

```json
{
  "type": "discussion_ended",
  "data": {
    "roomId": "R12345",
    "redirectTo": "/summary"
  }
}
```

#### pong

```json
{
  "type": "pong",
  "ts": 123
}
```

### Responsibilities

- keep discussion UI synchronized
- maintain current speaker display
- broadcast message additions
- support mock turn-taking behavior
- support mock interrupt workflow
- provide future-compatible protocol fields for media path / bot streaming / hints
- keep bot turn progression coherent, including cases where a bot finishes and the next assigned speaker is also a bot

---

## 17. `/api/ws/summary` Protocol

### Purpose

Used during summary phase.

### Client -> Server Messages

#### hello

```json
{
  "type": "hello",
  "uuid": "u_xxx",
  "roomId": "R12345"
}
```

#### ping

```json
{
  "type": "ping",
  "ts": 123
}
```

### Server -> Client Messages

#### summary_fixed

```json
{
  "type": "summary_fixed",
  "data": {
    "leaderMemberId": "m_xxx",
    "leaderSameAsLastSpeaker": true,
    "everyoneSpoke": true,
    "hasValidInterruption": true
  }
}
```

#### summary_stream

```json
{
  "type": "summary_stream",
  "data": {
    "chunk": "..."
  }
}
```

#### summary_done

```json
{
  "type": "summary_done",
  "data": {
    "fullText": "..."
  }
}
```

#### room_closed

```json
{
  "type": "room_closed",
  "data": {
    "redirectTo": "/setup"
  }
}
```

#### pong

```json
{
  "type": "pong",
  "ts": 123
}
```

### Responsibilities

- send deterministic summary results quickly
- optionally stream mock evaluator output
- support room cleanup lifecycle

---

## 18. Discussion State Machine Requirements

This milestone must implement a lightweight but consistent discussion state machine.

## 18.1 Initial Discussion State

When `/api/start` is called:

- `phase` becomes `discuss`
- `currentRound = 1`
- `currentSpeakerMemberId = null`
- `roundSpokenMemberIds = []`
- `leaderMemberId = null`
- `lastSpeakerMemberId = null`
- `hasInterruptionOccurred = false`
- `pendingInterruption = null`
- `messages = []`

### Implementation Interpretation Fixed Here

For this milestone, discussion begins with `currentSpeakerMemberId = null` and the **first valid server-authorized `start_speaking` request may claim the first speaker role atomically**.

No separate first-speaker-assignment API is required in this milestone.

This interpretation is now frozen for implementation and review.

---

## 18.2 Starting a Speech Turn

When a valid speaker starts speaking:

- if `currentSpeakerMemberId` is `null`, the first valid server-authorized caller may become the current speaker atomically
- otherwise only the assigned current speaker may start speaking
- discussion state records them as actively speaking
- websocket broadcasts `speaker_started`
- top bar updates current speaker
- if speaker is human, this is just mock state; no real media transmission occurs
- if speaker is bot, mock streaming text generation may begin

---

## 18.3 Stopping a Human Speech Turn

When a human speaker stops speaking:

- a mock message/transcript is created
- `lastSpeakerMemberId` becomes that speaker
- if `leaderMemberId` is null, set it to that speaker
- add speaker to `roundSpokenMemberIds` if not present
- if all discussion participants expected for the round have spoken, increment round and reset `roundSpokenMemberIds`
- assign the next speaker from the member chosen in the modal
- broadcast state update and message creation

### Important Future Compatibility

The stop event must retain future conceptual alignment with:

- audio finalization
- whisper transcription
- creation of transcript-backed chat messages

---

## 18.4 Interrupt Logic for Human Speaker

When a valid human member presses interrupt:

- only allowed if they have not yet spoken in this round
- only allowed if another speaker is actively speaking
- server creates `pendingInterruption`
- server sends `interrupt_requested` to current speaker
- current speaker may accept or reject

If rejected:

- `pendingInterruption` cleared
- current speaker continues
- broadcast `interrupt_resolved` with `accepted: false`

If accepted:

- current speaker turn is ended as interrupted
- an interrupted mock message may be created
- `hasInterruptionOccurred = true`
- interrupter becomes the current speaker
- `pendingInterruption` cleared
- broadcast `interrupt_resolved` with `accepted: true`

---

## 18.5 Bot Turn Logic

If next speaker is a bot:

- current milestone uses mock text streaming only
- server emits `bot_stream` chunks
- then emits `bot_done`
- bot turn should still count as a turn for round progression
- a future implementation may replace this with real OpenAI-compatible streamed generation

### Future Compatibility Requirement

The mock implementation should be structurally replaceable with:

- an abortable async generation task
- AbortController-based cancellation on human interrupt

### Continuation Requirement

When a bot turn finishes, the discuss flow must continue coherently:

- if the next assigned speaker is human, discussion state and UI must clearly reflect that assignment
- if the next assigned speaker is also a bot, the mock flow must continue rather than dead-ending silently

---

## 18.6 Interrupt Logic for Bot Speaker

If a bot is currently speaking and a human validly interrupts:

- bot does not reject interruption
- mock generation is terminated immediately
- `hasInterruptionOccurred = true`
- interrupter becomes current speaker
- in future, this maps to AbortController cancellation of streamed LLM output
- implementation should use a dedicated bot-interrupt path rather than awkwardly routing bot interruption through a human-speaker response authorization branch

---

## 18.7 Round Progression

A round is defined as a cycle in which each participant expected in discussion has spoken once.

### Current Milestone Expectation

The implementation should track round progression using the member list and `roundSpokenMemberIds`.

### Important Open Practical Interpretation Fixed Here

For this milestone, “participant expected in discussion” means **all current room members, including bots**.

This rule may be revised in future if product rules change, but for now it keeps the state machine deterministic.

When all room members have spoken during the current round:

- increment `currentRound`
- clear `roundSpokenMemberIds`
- continue discussion

---

## 19. Summary Computation Requirements

When discussion ends:

- room enters `summary`
- summary state is initialized
- deterministic rubric placeholders are computed from discussion state
- mock evaluator summary streaming may begin

### Deterministic Values to Compute

At minimum:

1. `leaderMemberId`
   - equals first speaker of discussion
2. `leaderSameAsLastSpeaker`
   - compare `leaderMemberId` and `lastSpeakerMemberId`
   - must remain `null` when insufficient data exists rather than collapsing missing-data cases into `true`
3. `everyoneSpoke`
   - whether every room member spoke at least once across the whole discussion
4. `hasValidInterruption`
   - whether at least one accepted interruption occurred

### Important Boundary

The system does **not** yet determine:

- whether the first speech actually performed an introduction well
- whether the final speech actually performed conclusion well
- whether discussion went off-topic
- stance shift quality
- consensus quality

Those remain future evaluator tasks, but the protocol and UI must leave room for them.

---

## 20. Room Cleanup Rules

### Cleanup Trigger

A room may be destroyed only when:

1. room phase is `summary`
2. all human `/api/ws/summary` connections for that room have lost heartbeat / disconnected for timeout duration

### Explicit Rule

Bots do not count toward connection liveness because they do not own browsers and do not have frontend websocket sessions.

### Timeout

Default cleanup timeout for this milestone: **30 seconds**.

### Expected Behavior

If the room is destroyed and any stale client remains, it should eventually receive or infer room closure and be returned to `/setup`.

### Robustness Requirement

This cleanup must be triggered by effective loss of summary human liveness, not only by clean websocket close events. Stale heartbeat expiry is sufficient to schedule cleanup.

---

## 21. Frontend Architecture Final Decision

The frontend must use the lightweight static approach.

### Chosen Approach

- static HTML pages
- CSS files
- frontend JavaScript modules
- no React
- no Vue
- no TSX-based page rendering system
- no framework-heavy SPA complexity required for this milestone

### Rationale

- reduces implementation overhead
- matches low-fidelity demo goal
- easier to debug and present
- easier later to keep as final product style if desired

---

## 22. Frontend Implementation Expectations

## 22.1 General

Frontend should:

- use fetch for POST APIs
- use WebSocket for phase-specific live communication
- use local storage or in-memory browser state as needed for current UUID and roomId
- reconnect only according to page lifecycle, not hidden background complexity
- explicitly close old websocket on page transition
- use `POST /api/room/state` to support refresh/re-entry recovery before assuming local navigation state is still valid

## 22.2 Local Browser State Suggestions

Frontend may keep:

- `uuid`
- `roomId`
- `memberId` for current human in that room
- `phase`
- `isOwner`

This is not authoritative state; authoritative state remains server-side and can be rehydrated via `/api/room/state`.

### Important Recovery Rule

`memberId` in local storage is only a cache. Frontend must be able to recover it from room membership data returned by `/api/room/state` when it is missing or stale.

## 22.3 Modal Strategy

Interactive popups may be implemented using:

- HTML dialog elements, or
- ordinary overlay divs + JS show/hide logic

No advanced component library is required.

---

## 23. Backend Architecture Final Decision

## 23.1 Core Stack

- TypeScript
- Node.js
- Express
- websocket support via a suitable library such as `ws`
- in-memory stores for sessions and rooms

## 23.2 Suggested Backend Module Boundaries

The implementation should be organized so future replacement of mock services is easy.

Recommended module areas:

1. `server/bootstrap`
   - app startup
   - middleware
   - route registration
   - websocket registration
2. `routes/api`
   - POST endpoints
3. `ws`
   - setup socket handlers
   - discuss socket handlers
   - summary socket handlers
4. `stores`
   - user session store
   - room store
   - websocket connection registry
5. `services`
   - id generation service
   - room service
   - discussion service
   - summary service
   - mock bot stream service
   - mock hint service
6. `models/types`
   - shared TypeScript types
7. `public`
   - frontend HTML/CSS/JS assets
8. `config`
   - env loading
   - future integration URLs

### Important Architectural Goal

Mock logic should be isolated so later real services can replace:

- bot generation
- hint generation
- transcription submission
- media channel orchestration

without requiring websocket protocol redesign.

---

## 24. Future Integration Preservation Requirements

Although current version is mock-only for AI/audio, the architecture must preserve clear integration points.

## 24.1 whisper.cpp Integration Reservation

Future backend should be able to:

- receive finalized audio segment references or buffers after a speech turn
- call whisper.cpp server container
- receive transcript text
- convert transcript text into `message_created` event entries

Current version need not call whisper.cpp, but config and service placeholders should anticipate this.

## 24.2 mediaMTX Integration Reservation

Future backend should be able to:

- allocate or accept dynamic media paths/channels
- notify listeners about speaker stream path
- handle speaker start/stop lifecycle

Current version may keep `mediaPath` as placeholder field in websocket protocol.

## 24.3 LLM Integration Reservation

Future backend should be able to:

- create bot turns using OpenAI-compatible streamed generation
- provide hint generation for human user
- provide evaluator summary generation in summary phase
- support AbortController cancellation for bot generation when interrupted

Current mock services should preserve the async streamed shape of these operations.

---

## 25. Docker and Containerization Final Decision

## 25.1 Required Containers in `docker-compose.yml`

The compose file must declare at least:

1. `app`
   - our TypeScript/Node.js/Express backend
2. `whisper`
   - whisper.cpp server container placeholder
3. `mediamtx`
   - mediamtx container placeholder

### Current Milestone Rule

`whisper` and `mediamtx` are declared in compose but do not need to be actively called by backend business logic yet.

---

## 25.2 Backend Dockerfile

A Dockerfile is required for packaging the backend service.

### Expected Goals

- install dependencies
- build TypeScript if necessary
- serve static frontend assets
- run the Express server

### Implementation Freedom

The exact Dockerfile style may vary, but it should support a straightforward developer workflow and compose integration.

---

## 25.3 No Reverse Proxy Requirement

For this milestone:

- no nginx required
- no reverse proxy required
- backend may directly serve HTTP and websocket traffic

---

## 26. Error Handling Expectations

The prototype should still behave coherently when common invalid operations happen.

At minimum, APIs and websocket handlers should explicitly handle:

- nonexistent room
- nonexistent user UUID
- room phase mismatch
- non-owner attempting owner-only action
- joining a non-joinable room
- removing nonexistent member
- invalid next speaker memberId
- interrupt attempt when button should logically be invalid
- websocket connection with invalid roomId or uuid

Errors do not need enterprise-grade sophistication, but they must return clear structured results.

---

## 27. Security and Persistence Assumptions

This is a prototype and uses deliberate simplifications.

### Assumptions

- users are anonymous
- no login system exists
- no database exists
- all data is lost when server restarts
- UUID is only a temporary session identifier, not a secure identity token

This is acceptable for the current milestone.

---

## 28. Resolved Decisions Summary Embedded into Final State

The following decisions are explicitly frozen for this milestone:

1. `/setup` supports anonymous setup, room joining, and joined non-owner lobby waiting mode.
2. `/setup` includes roomId input and create-room button in fresh mode.
3. Room creation automatically adds owner into the room.
4. Owner remains on setup websocket while in lobby/create phase.
5. On phase switch, frontend closes old websocket and opens the new phase websocket.
6. Membership is unified under `memberId`.
7. Discussion state machine is in scope.
8. Real AI/transcription/audio are out of scope.
9. Mock discuss behavior is in scope.
10. No dedicated reset API is needed.
11. `POST /api/room/state` is included.
12. Websocket handshake may use query params.
13. Bots do not have heartbeats.
14. Room cleanup in summary depends on human websocket heartbeats only.
15. Cleanup timeout is 30 seconds.
16. Frontend uses static HTML/CSS/JS rather than TSX-heavy framework architecture.
17. `docker-compose.yml` includes app + whisper + mediamtx.
18. Backend Dockerfile is required.
19. No reverse proxy is required.
20. Non-owner joiners stay on `/setup` in joined-lobby waiting mode rather than reusing owner `/create` semantics.
21. Refresh recovery must use `/api/room/state` and may reconstruct missing local `memberId` from returned room membership.
22. First-speaker claim is server-authoritative when `currentSpeakerMemberId` is initially `null`.
23. Bot streaming must be visible in discuss UI.
24. Summary streaming should use explicit cursor-style progression.

---

## 29. Known Uncertainties That Do Not Block Implementation

The following are intentionally left flexible and do not block implementation:

1. exact room ID formatting
2. exact UUID formatting style
3. exact CSS visual style
4. exact modal implementation technique
5. exact backend folder structure
6. exact websocket library choice
7. exact mock text content for bot speech, hint responses, and summary output
8. exact visual styling of joined non-owner lobby waiting mode on `/setup`
9. exact policy for whether owner can remove self in future versions
10. whether summary page displays current round index or completed round count, as long as this does not contradict primary rubric semantics

These may be finalized during implementation as long as they remain compatible with this document.

---

## 30. Acceptance Criteria for This Milestone

The milestone is complete only if the delivered system satisfies all of the following:

1. Visiting `/setup` in fresh mode generates and displays a new anonymous UUID.
2. `/setup` allows room join by roomId.
3. Owner can create a room and is automatically inserted into it.
4. `/create` displays room ID and member list for the owner.
5. Non-owner users who joined a room remain on `/setup` in joined-lobby waiting mode and can see joined-room waiting information plus live member updates.
6. Owner can add and remove bots in the room.
7. Human users can join the room during lobby.
8. Setup websocket pushes room member updates.
9. Owner can start discussion.
10. Starting discussion redirects owner and pushes others into `/discuss`.
11. `/discuss` connects to discuss websocket and displays synchronized discussion state.
12. `/discuss` has top bar, message area, bottom three-button layout, modals, and owner-only end-discussion control.
13. Discuss page button enablement follows the frozen state rules.
14. Mock discussion actions can drive state transitions for turn-taking.
15. The first speaker can be claimed coherently from the initial null-speaker state through the approved server-authoritative rule.
16. Interrupt flow is represented in UI and websocket/state logic.
17. Bot mock turn streaming placeholder exists and is visible in the discuss UI.
18. Bot turn progression does not dead-end silently when transitioning to the next assigned speaker.
19. Owner can end discussion.
20. Ending discussion redirects all members into `/summary`.
21. `/summary` connects to summary websocket and shows deterministic rubric placeholders plus mock streamed evaluator summary text.
22. Reset returns user to `/setup`, which generates a new UUID unless the frontend is deliberately preserving a valid joined-lobby waiting context under the dual-mode `/setup` rules.
23. Room auto-cleanup logic exists for summary phase based on effective human heartbeat disappearance.
24. Refresh/re-entry during lobby/discuss/summary uses `/api/room/state` coherently and restores role-appropriate page routing.
25. Missing local `memberId` can be recovered from room membership data returned by `/api/room/state`.
26. `docker-compose.yml` declares app, whisper, mediamtx.
27. Backend has a Dockerfile.
28. API response format is uniform across all non-websocket endpoints.
29. Frontend preserves backend JSON error messages where available.
30. The code structure leaves clear seams for later integration of whisper.cpp, mediaMTX, and real LLM services.

---

## 31. Final Instruction to Downstream Agents

Any planner, implementer, or reviewer working on this milestone must treat this document as the authoritative target state.

If implementation convenience conflicts with this document, implementation must not silently drift. Either:

- follow this document, or
- explicitly revise this document first through orchestration.
