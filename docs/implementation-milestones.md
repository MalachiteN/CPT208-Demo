# Implementation Milestones

## 1. Document Purpose

This document defines the implementation milestones derived from the authoritative target state in `docs/final-target-state.md`.

Its purpose is to turn the frozen target state into an execution sequence suitable for implementation agents.

This document is intentionally engineering-oriented:

- what should be built first
- what each milestone must contain
- what modules are involved
- what dependencies exist between milestones
- what acceptance checks define milestone completion
- what can be parallelized safely

This document does not replace `docs/final-target-state.md`. If any implementation detail here conflicts with the final target state, the final target state document remains authoritative.

---

## 2. Execution Strategy

The project should be built in layers:

1. **foundation first**
   - TypeScript/Express project skeleton
   - static asset serving
   - shared types and stores
2. **lobby flow second**
   - setup/create pages
   - user and room management
   - setup websocket
3. **discussion core third**
   - discussion state machine
   - discuss websocket
   - discuss page UI and interactions
4. **summary flow fourth**
   - summary derivation
   - summary websocket
   - summary page
5. **containerization and integration verification last**
   - Dockerfile
   - docker-compose
   - walkthrough testing

This order minimizes rework because the later pages depend on room and phase state already being correct.

---

## 3. Recommended Project Structure

The following structure is recommended for implementation.

```text
src/
  server/
    index.ts
    app.ts
    websocket-server.ts

  routes/
    api.ts
    setup.ts
    room.ts
    member.ts
    phase.ts

  middleware/
    error-handler.ts
    response-wrapper.ts
    validation.ts

  ws/
    setup-ws.ts
    discuss-ws.ts
    summary-ws.ts
    connection-manager.ts
    message-types.ts

  stores/
    user-session-store.ts
    room-store.ts

  services/
    id-service.ts
    room-service.ts
    discussion-service.ts
    summary-service.ts
    bot-service.ts
    hint-service.ts

  models/
    types.ts

  config/
    index.ts

  utils/
    helpers.ts

public/
  setup.html
  create.html
  discuss.html
  summary.html

  css/
    common.css
    setup.css
    create.css
    discuss.css
    summary.css

  js/
    common/
      api.js
      websocket.js
      storage.js
      ui.js

    pages/
      setup.js
      create.js
      discuss.js
      summary.js

    components/
      member-list.js
      message-list.js
      modals.js
```

This exact structure is not mandatory, but implementation should preserve these boundaries:

- types separate from services
- stores separate from route handlers
- websocket handlers separate by phase
- mock AI/audio logic isolated from the rest of the backend
- frontend page logic separate from shared frontend utilities

---

## 4. Milestone 1 — Foundation and Server Skeleton

## Goal

Create the base TypeScript + Node.js + Express project and make the server capable of serving static frontend files.

## Must Include

1. `package.json`
2. `tsconfig.json`
3. backend startup entrypoint
4. Express app bootstrap
5. static file serving for `public/`
6. development scripts
7. TypeScript build script
8. basic environment configuration loading
9. simple health endpoint

## Suggested Dependencies

- `express`
- `ws`
- `typescript`
- `ts-node` or equivalent
- `nodemon` or equivalent
- `@types/node`
- `@types/express`
- `@types/ws`
- optional lightweight validation library if desired

## Modules Involved

- `src/server/index.ts`
- `src/server/app.ts`
- `src/config/index.ts`
- `public/` minimal placeholder assets

## Acceptance Criteria

- server starts successfully in development mode
- TypeScript compiles successfully
- static file serving works
- a health endpoint returns success
- project can host plain HTML pages from `public/`

## Dependency

None.

## Parallelization

This milestone should be done first and not split unless multiple people coordinate tightly.

---

## 5. Milestone 2 — Core Types and In-Memory Stores

## Goal

Create all shared state models and in-memory storage primitives required by the room lifecycle.

## Must Include

### Shared Types

Implement shared TypeScript models for:

- `UserSession`
- `Member`
- `Room`
- `DiscussionState`
- `SummaryState`
- `ChatMessage`

### Stores

Implement in-memory stores for:

- user sessions
- rooms
- websocket connection registry or equivalent connection tracking

### ID Generation

Implement ID generation utilities for:

- user uuid
- roomId
- memberId
- messageId

## Modules Involved

- `src/models/types.ts`
- `src/stores/user-session-store.ts`
- `src/stores/room-store.ts`
- `src/ws/connection-manager.ts` or equivalent
- `src/services/id-service.ts`

## Acceptance Criteria

- all core types compile cleanly
- session store supports create/get/delete
- room store supports create/get/update/delete
- rooms can contain human and bot members using unified `memberId`
- owner auto-membership can be represented in state
- discussion and summary sub-state can be attached to rooms

## Dependency

Requires Milestone 1.

## Parallelization

This milestone should be completed before the API layer is implemented.

---

## 6. Milestone 3 — HTTP API Layer for Setup, Room, Member, and Phase Control

## Goal

Implement all non-websocket APIs required by the frozen target state.

## Must Include

### Endpoints

1. `POST /api/setup`
2. `POST /api/create`
3. `POST /api/adduser`
4. `POST /api/addbot`
5. `POST /api/remove`
6. `POST /api/start`
7. `POST /api/end`
8. `POST /api/room/state`

### Cross-Cutting API Rules

- JSON request body parsing
- uniform response shape
- request validation
- clear failure responses
- owner-only enforcement where needed
- phase validation where needed

## Expected Endpoint Priorities Within This Milestone

### Implement First

- `/api/setup`
- `/api/create`
- `/api/adduser`
- `/api/room/state`

These unblock the lobby pages and recovery logic.

### Implement Second

- `/api/addbot`
- `/api/remove`
- `/api/start`
- `/api/end`

These complete room management and phase transitions.

## Modules Involved

- `src/routes/api.ts`
- `src/routes/setup.ts`
- `src/routes/room.ts`
- `src/routes/member.ts`
- `src/routes/phase.ts`
- `src/middleware/response-wrapper.ts`
- `src/middleware/validation.ts`
- `src/middleware/error-handler.ts`
- `src/services/room-service.ts`

## Acceptance Criteria

- every endpoint is `POST`
- every endpoint returns `{ success, msg, data }`
- `/api/setup` returns a new UUID per request
- `/api/create` creates a room and auto-adds the owner as a human member
- `/api/adduser` only succeeds for lobby-phase rooms
- `/api/addbot` and `/api/remove` only succeed for owner
- `/api/start` moves room to `discuss`
- `/api/end` moves room to `summary`
- `/api/room/state` returns enough data for page rehydration after refresh

## Dependency

Requires Milestone 2.

## Parallelization

Some frontend scaffolding can start in parallel once endpoint shapes are frozen, but backend should finish the API contracts first.

---

## 7. Milestone 4 — Setup WebSocket and Lobby Synchronization

## Goal

Implement the websocket channel used during setup/lobby/create phase.

## Must Include

### Endpoint

- `/api/ws/setup`

### Client Message Handling

- `hello`
- `ping`

### Server Message Emission

- `room_update`
- `discussion_started`
- `removed_from_room`
- `room_closed`
- `pong`

### Handshake Rules

- validate `uuid`
- validate `roomId`
- validate human membership in the room
- ensure the room is in correct phase for this socket’s usage pattern

### Behavior Requirements

- keep member list synchronized during lobby
- notify joined users of current room state
- notify non-owner users when owner starts discussion
- notify removed users to return to `/setup`

## Modules Involved

- `src/ws/setup-ws.ts`
- `src/ws/connection-manager.ts`
- `src/ws/message-types.ts`
- room/member services as needed

## Acceptance Criteria

- setup websocket connects successfully for valid member/room combinations
- invalid websocket attempts are rejected cleanly
- client `hello` causes state to be pushed or acknowledged
- `ping` receives `pong`
- add/remove user or bot causes room updates to be broadcast to lobby clients
- starting discussion pushes `discussion_started` to appropriate users

## Dependency

Requires Milestone 3.

## Parallelization

Frontend setup/create implementation can begin once this milestone’s message contracts are stable.

---

## 8. Milestone 5 — Frontend Setup and Create Pages

## Goal

Implement `/setup` and `/create` as working pages using the real backend APIs and setup websocket.

## Must Include

### `/setup`

- load and display anonymous UUID
- roomId input box
- join room button
- create room button
- fetch integration with `/api/setup`
- join flow with `/api/adduser`
- create flow with `/api/create`
- after successful join or create, persist minimal browser state needed for page transitions

### `/create`

- prominent roomId display
- live member list
- bot name input
- bot persona input
- add bot button
- remove buttons for members
- start discussion button
- setup websocket integration while in lobby

### Shared Frontend Utilities

- API wrapper for uniform POST calls
- websocket wrapper
- local storage helpers
- basic modal or popup helpers if useful

## Modules Involved

- `public/setup.html`
- `public/create.html`
- `public/js/pages/setup.js`
- `public/js/pages/create.js`
- `public/js/common/api.js`
- `public/js/common/websocket.js`
- `public/js/common/storage.js`
- `public/js/components/member-list.js`
- `public/css/setup.css`
- `public/css/create.css`
- `public/css/common.css`

## Acceptance Criteria

- `/setup` shows a newly assigned UUID on load
- `/setup` allows room join by roomId
- room creation redirects owner into `/create`
- `/create` shows roomId clearly
- member list is updated live over setup websocket
- owner can add bot and remove members
- owner can start discussion from `/create`
- page logic closes or replaces setup socket appropriately on later phase transition

## Dependency

Requires Milestones 3 and 4.

## Parallelization

This milestone can proceed in parallel with discussion-state backend work once the lobby contracts are done.

---

## 9. Milestone 6 — Discussion State Machine and Mock Discussion Services

## Goal

Build the discussion state model and the mock behaviors that drive discuss-page interactions.

## Must Include

### Discussion State Logic

- initialize discussion state when room enters `discuss`
- track `currentRound`
- track `currentSpeakerMemberId`
- track `roundSpokenMemberIds`
- track `leaderMemberId`
- track `lastSpeakerMemberId`
- track `hasInterruptionOccurred`
- track `pendingInterruption`
- maintain message history

### Mock Service Behaviors

- start speaking
- stop speaking
- add mock message/transcript on human turn completion
- select next speaker using `memberId`
- move rounds forward after all room members have spoken in current round
- bot mock streamed text output
- mock AI hint generation

### Interrupt Logic

- valid interrupt requests only when rules permit
- pending interruption creation
- accept/reject path for human target speaker
- automatic yield behavior for bot speaker

## Modules Involved

- `src/services/discussion-service.ts`
- `src/services/bot-service.ts`
- `src/services/hint-service.ts`
- room store and shared types

## Acceptance Criteria

- discussion state is initialized correctly when discussion starts
- first completed speaker is recorded as leader
- last completed speaker is tracked
- round progression works deterministically
- accepted interruption marks `hasInterruptionOccurred = true`
- bot turns can be simulated asynchronously
- mock AI hint responses are available through service boundary
- service boundaries are clean enough to later replace mock logic with real whisper/LLM/media integrations

## Dependency

Requires Milestone 3. Strongly preferred before discuss websocket implementation.

## Parallelization

Can run in parallel with some frontend styling work, but not with discuss websocket contract finalization unless coordination is tight.

---

## 10. Milestone 7 — Discuss WebSocket and Real-Time Discussion Synchronization

## Goal

Implement the discussion-phase websocket and connect it to the discussion state machine.

## Must Include

### Endpoint

- `/api/ws/discuss`

### Client Message Handling

- `hello`
- `start_speaking`
- `stop_speaking`
- `interrupt_request`
- `interrupt_response`
- `ask_hint`
- `ping`

### Server Message Emission

- `discussion_state`
- `speaker_started`
- `speaker_stopped`
- `message_created`
- `interrupt_requested`
- `interrupt_resolved`
- `hint`
- `bot_stream`
- `bot_done`
- `discussion_ended`
- `pong`

### Integration Rules

- must validate membership and room phase
- must update discussion state through service layer rather than ad hoc mutation
- must broadcast enough state for UI synchronization
- must preserve placeholder `mediaPath` fields for future integration

## Modules Involved

- `src/ws/discuss-ws.ts`
- `src/ws/connection-manager.ts`
- `src/ws/message-types.ts`
- `src/services/discussion-service.ts`
- `src/services/bot-service.ts`
- `src/services/hint-service.ts`

## Acceptance Criteria

- discuss websocket only accepts valid discussion-phase members
- `start_speaking` changes current speaking state and broadcasts updates
- `stop_speaking` creates message and allows next-speaker assignment flow
- `interrupt_request` and `interrupt_response` work correctly
- `ask_hint` returns mock hint text
- bot mock streaming events reach clients in sequence
- owner ending discussion causes `discussion_ended` broadcast to participants

## Dependency

Requires Milestone 6.

## Parallelization

Frontend discuss page implementation can begin against frozen contracts once this milestone’s event design is fixed.

---

## 11. Milestone 8 — Frontend Discuss Page

## Goal

Implement the `/discuss` page with the required layout, state-driven button enablement, message display, and modal interactions.

## Must Include

### Top-Level Layout

- top bar with current speaker
- owner-only end discussion button in the upper-right
- scrollable message history area
- bottom fixed control bar with three buttons

### Bottom Buttons

- speech input button
- interrupt button
- AI hint button

### Modal Interactions

- next speaker selection modal after finishing a turn
- accept/reject interruption modal for current human speaker
- end discussion confirmation modal

### UI State Rules

- speech input enabled only for assigned current speaker
- speech input toggles between start and end state
- interrupt enabled only when rules allow it
- AI hint enabled only when user is assigned to speak and has not started
- all other cases visibly disabled/greyed

### Message Display

- all messages left aligned
- speaker display name shown on each row
- simple message history similar in spirit to IRC/Matrix style, not modern dual-sided IM layout

## Modules Involved

- `public/discuss.html`
- `public/js/pages/discuss.js`
- `public/js/components/message-list.js`
- `public/js/components/modals.js`
- `public/js/common/ui.js`
- `public/css/discuss.css`

## Acceptance Criteria

- discuss page connects to `/api/ws/discuss` after entering discuss phase
- old setup websocket is closed when discuss page is entered
- current speaker is shown clearly
- three-button bottom bar is present and fixed to bottom
- stopping a turn opens next-speaker selection modal
- interruption request displays prominent accept/reject modal to active human speaker
- owner can end discussion with confirmation dialog
- message history updates live from websocket events
- button enablement obeys state rules

## Dependency

Requires Milestone 7.

## Parallelization

Can be developed in partial parallel with summary backend work once discussion websocket contracts are stable.

---

## 12. Milestone 9 — Summary Service and Deterministic Rubric Derivation

## Goal

Implement summary-phase data derivation from the finished discussion state.

## Must Include

### Deterministic Summary Derivation

At minimum compute:

- `leaderMemberId`
- `leaderSameAsLastSpeaker`
- `everyoneSpoke`
- `hasValidInterruption`

### Mock Evaluator Output

- initialize mock summary text generation state
- support streamed summary text shape for frontend consumption

## Modules Involved

- `src/services/summary-service.ts`
- `src/services/discussion-service.ts` as data source
- shared types and room store

## Acceptance Criteria

- ending discussion initializes summary state
- fixed rubrics are computed from actual discussion state
- mock summary stream text can be produced through service boundary
- summary state is stored in room and can be rehydrated by `/api/room/state`

## Dependency

Requires Milestone 6 and room phase control from Milestone 3.

## Parallelization

Can be built in parallel with the discuss page once discussion state shape is stable.

---

## 13. Milestone 10 — Summary WebSocket and Room Cleanup Lifecycle

## Goal

Implement summary-phase websocket delivery and room cleanup based on human summary heartbeat disappearance.

## Must Include

### Endpoint

- `/api/ws/summary`

### Client Message Handling

- `hello`
- `ping`

### Server Message Emission

- `summary_fixed`
- `summary_stream`
- `summary_done`
- `room_closed`
- `pong`

### Cleanup Logic

- bots do not contribute heartbeats
- only human summary websocket connections count
- if all human summary connections are gone or stale for 30 seconds, room is destroyed

## Modules Involved

- `src/ws/summary-ws.ts`
- `src/ws/connection-manager.ts`
- `src/services/summary-service.ts`
- room store cleanup logic

## Acceptance Criteria

- summary websocket validates room and phase correctly
- `hello` can trigger immediate fixed rubric delivery
- summary text can stream incrementally
- room cleanup only occurs in summary phase
- cleanup logic ignores bots
- stale or disconnected summary clients eventually lead to room destruction after timeout

## Dependency

Requires Milestone 9.

## Parallelization

Frontend summary page can begin once the message contract is stable.

---

## 14. Milestone 11 — Frontend Summary Page

## Goal

Implement `/summary` as the final page in the room lifecycle.

## Must Include

- emoji-based rubric status strip at top
- fixed rubric result display area
- summary text display area for streamed mock evaluator output
- reset button returning to `/setup`
- closure of discuss websocket before summary websocket connection begins

## Reset Behavior

- no dedicated reset API
- user returns to `/setup`
- `/setup` requests a new UUID via `/api/setup`
- local browser state should be cleared or overwritten appropriately

## Modules Involved

- `public/summary.html`
- `public/js/pages/summary.js`
- `public/css/summary.css`
- shared websocket/storage utilities

## Acceptance Criteria

- entering summary connects to `/api/ws/summary`
- fixed rubric results show up quickly
- mock summary text streams visibly into the page
- reset returns to setup and results in a new UUID
- summary page remains simple and readable

## Dependency

Requires Milestone 10.

## Parallelization

Minimal; should follow summary websocket completion.

---

## 15. Milestone 12 — Dockerization

## Goal

Package the backend and declare the full local multi-container environment.

## Must Include

### Files

- `Dockerfile`
- `docker-compose.yml`

### Compose Services

- `app`
- `whisper`
- `mediamtx`

### Rules

- backend must be packaged in Docker
- whisper and mediamtx are declared but not yet actively used by backend business logic
- no reverse proxy is required

## Modules Involved

- repository root Docker assets
- env/config loading in backend

## Acceptance Criteria

- backend image builds successfully
- compose starts all declared services
- backend is reachable via configured port
- static pages and websocket endpoints work when app runs in container
- placeholder whisper and mediamtx services exist in compose as required

## Dependency

Can start after Milestone 1, but final verification should happen after main application flow exists.

## Parallelization

Can be partly done in parallel with application development.

---

## 16. Milestone 13 — Integration Verification and Bug Fixing

## Goal

Verify that the complete room lifecycle works end-to-end and that the implementation matches the final target state.

## Must Include

### End-to-End Walkthroughs

1. setup → create room → create page
2. second user setup → join room → lobby updates visible
3. owner adds/removes bot
4. owner starts discussion → all human users enter discuss
5. speaking flow and next-speaker selection work
6. interrupt flow works
7. bot mock speaking flow works
8. owner ends discussion → all human users enter summary
9. summary fixed rubric data shows
10. mock summary stream shows
11. reset returns to setup and creates new UUID
12. room cleanup happens after summary heartbeat loss timeout

### Refresh and Recovery Checks

- `/api/room/state` supports rehydration
- page refresh during lobby behaves coherently
- page refresh during discuss behaves coherently
- page refresh during summary behaves coherently

### Error Handling Checks

- invalid roomId
- invalid uuid
- invalid phase actions
- non-owner owner-only action attempts
- invalid memberId for remove/next-speaker operations

## Acceptance Criteria

- all required flows work without critical breakage
- all page transitions are coherent
- old phase websocket connections are not left active unintentionally
- API failures are structured and readable
- state remains internally consistent under normal user flow

## Dependency

Requires Milestones 1 through 12.

## Parallelization

This is the final convergence milestone and should be coordinated centrally.

---

## 17. Backend Implementation Priority Guidance

Within the backend, the recommended order is:

1. core types and stores
2. room/session services
3. minimal setup/create APIs
4. setup websocket
5. discussion service
6. discuss websocket
7. summary service
8. summary websocket
9. cleanup logic hardening

This order ensures that the frontend is never built against unstable state semantics.

---

## 18. Frontend Implementation Priority Guidance

Within the frontend, the recommended order is:

1. shared fetch/websocket/storage utilities
2. `/setup`
3. `/create`
4. shared modal/message rendering helpers
5. `/discuss`
6. `/summary`

This avoids duplicating page-local infrastructure.

---

## 19. What Should Be Implemented First vs Deferred Inside This Milestone

## Implement First

These items are foundational and should not be deferred:

- project skeleton
- shared types
- in-memory stores
- `POST /api/setup`
- `POST /api/create`
- `POST /api/adduser`
- `POST /api/room/state`
- `/api/ws/setup`
- `/setup`
- `/create`

Without these, the basic room lifecycle cannot be demonstrated.

## Implement Second

These items form the core interaction value and should be built after lobby flow is stable:

- discussion state machine
- `/api/ws/discuss`
- `/discuss`
- interrupt handling
- next-speaker flow
- mock bot behavior
- mock hint behavior

## Implement Third

These complete the lifecycle and should follow once discuss flow is stable:

- summary derivation
- `/api/ws/summary`
- `/summary`
- room cleanup logic

## Defer Within the Current Milestone

These should remain intentionally minimal for now:

- visual polish beyond clean low-fidelity layout
- robust reconnection sophistication beyond basic coherence
- advanced form validation UX
- production-grade logging/observability
- any real AI/transcription/media implementation
- mobile layout optimization

---

## 20. Notable Risks and Mitigation

## Risk 1: Discussion State Drift

### Problem
Discussion logic may become inconsistent if websocket handlers mutate room state directly.

### Mitigation
All meaningful discuss-phase changes should go through `discussion-service.ts` rather than ad hoc mutation in route or socket files.

---

## Risk 2: Phase Transition Socket Leaks

### Problem
If old phase websockets are not closed when entering a new page, the same user may remain connected in multiple phase channels.

### Mitigation
Frontend page logic must explicitly close the current websocket before opening the next phase websocket.
Server-side connection tracking should also tolerate stale sockets and clean them up.

---

## Risk 3: Refresh Recovery Inconsistency

### Problem
User refresh during discuss or summary may leave frontend on the wrong page.

### Mitigation
Use `/api/room/state` on page initialization or recovery flows to determine the authoritative phase and redirect if needed.

---

## Risk 4: Mock Logic Entanglement with Real Integration Paths

### Problem
If mock bot/hint logic is implemented inline inside websocket handlers, later replacement with real services will be messy.

### Mitigation
Keep mock bot streaming, mock hint generation, and future evaluator mock output in isolated service modules with clear interfaces.

---

## Risk 5: Room Cleanup Edge Cases

### Problem
Room cleanup tied to websocket heartbeats may fail if the system does not distinguish human and bot members clearly.

### Mitigation
Only websocket-connected human members count toward summary liveness. This rule should be encoded directly in cleanup logic.

---

## Risk 6: Overbuilding the Prototype

### Problem
Because the final vision is rich, implementation may accidentally drift into real AI/audio work too early.

### Mitigation
Treat all AI/audio/transcription actions as protocol placeholders only. Build the seam, not the real integration.

---

## 21. Verification Checklist by System Area

## API Layer

- all endpoints are POST
- all responses share unified shape
- failures are explicit and readable
- room phase and owner checks are enforced

## WebSocket Layer

- each endpoint validates room/user/phase correctly
- ping/pong works
- broadcasts reach all expected human clients in room
- bot does not require socket presence

## Lobby Flow

- owner auto-joins room on creation
- users can join by roomId
- member list updates in real time
- owner can start discussion

## Discuss Flow

- current speaker is visible
- buttons enable/disable correctly
- next-speaker flow works
- interruption flow works
- bot mock flow works

## Summary Flow

- end discussion redirects everyone to summary
- fixed rubric data is visible
- mock streamed summary text is visible
- reset returns to setup and yields a new UUID

## Cleanup Flow

- summary room cleanup only depends on human summary connections
- timeout is 30 seconds
- destroyed rooms no longer behave as active rooms

---

## 22. Milestone Completion Standard

The implementation milestone plan is considered fully executed only when:

1. all milestones from 1 to 13 are completed,
2. the delivered system satisfies the acceptance criteria in `docs/final-target-state.md`, and
3. the implementation leaves clear extension points for future whisper.cpp, mediamtx, and real LLM integration.

---

## 23. Instruction for Downstream Implementation Agents

Implementation agents should treat this document as the execution roadmap and `docs/final-target-state.md` as the authority on intended behavior.

If an implementation tradeoff becomes necessary:

- do not silently change product behavior,
- prefer preserving protocol shape and state model integrity,
- escalate contradictions rather than improvising around them.
