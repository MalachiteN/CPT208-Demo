# Stage 2 Implementation Milestones

## 1. Purpose

This document defines the implementation plan for **Stage 2** of the CPT208 discussion rehearsal system.

Authoritative behavior for Stage 2 is defined by:
- `docs/final-target-state-stage2.md` — primary source of truth for Stage 2
- `docs/final-target-state.md` — still authoritative for unchanged Stage 1 behavior
- `docs/implementation-milestones.md` — useful Stage 1 execution pattern and module boundaries

This plan assumes the existing Stage 1 codebase is already present and working, and focuses on replacing Stage 1 mock seams with real infrastructure while preserving:
- page flow
- room lifecycle
- websocket protocol shape
- summary/lobby/discuss routing
- existing state-machine semantics unless Stage 2 explicitly changes them

---

## 2. Starting State Assessment

The current Stage 1 codebase already provides the correct structural seams, but several Stage 2 gaps are clear:

### Already in place
- room lifecycle and phase transitions
- setup/discuss/summary websocket channels
- discussion state machine baseline
- frontend pages for `/setup`, `/create`, `/discuss`, `/summary`
- bot/hint/summary service boundaries
- dockerized app + whisper + mediamtx placeholders

### Still mock / needing replacement
- `src/services/bot-service.ts` uses in-memory mock chunking
- `src/services/hint-service.ts` returns random mock hints
- `src/services/summary-service.ts` streams fixed mock summary chunks
- `src/services/discussion-service.ts` still creates mock human transcript text
- `public/js/pages/discuss.js` still sends placeholder `mediaPath` and has no real microphone/WebRTC logic
- config names do not match Stage 2 target env contract
- no prompt file loading system exists yet
- no real mediamtx audio collection/transcription path exists yet
- no AbortController-based live LLM cancellation exists yet
- no discussion-state `currentSpeakerActive` field exists yet

This means Stage 2 should be executed as a **targeted backend-service replacement plus frontend media integration milestone**, not as a redesign.

---

## 3. Execution Strategy

Recommended execution order:

1. **freeze Stage 2 config and contracts first**
2. **upgrade backend state model and service interfaces second**
3. **implement real audio pipeline and transcription path before wiring frontend audio UX fully**
4. **replace LLM mocks with real prompt-driven service calls**
5. **then integrate discuss/summary frontend behavior with the real backend**
6. **finish with container/env verification and failure-path testing**

This order reduces rework because:
- frontend audio logic depends on stable mediamtx URLs and websocket semantics
- bot/hint/summary integration depends on stable prompt/config contracts
- interruption handling depends on a finalized streaming context model
- end-to-end testing is only meaningful after audio + LLM + cleanup behavior exist together

---

## 4. Milestone Plan

## Milestone 1 — Stage 2 Contract Alignment and Configuration Foundation

### Goal
Bring the codebase’s configuration, types, and file layout into alignment with the Stage 2 target state before implementing external integrations.

### Major changes in this milestone
- normalize environment variable contract to Stage 2 names
- add prompt-file infrastructure
- extend state/types with Stage 2 additions
- define backend service boundaries for real integrations

### Backend module breakdown

#### New or modified modules
1. **`src/config/index.ts` — modify**
   - replace current placeholder config names with Stage 2 contract:
     - `OPENAI_BASEURL`
     - `OPENAI_API_KEY`
     - `ROLEPLAY_MODEL`
     - `HINT_MODEL`
     - `SUMMARY_MODEL`
     - `WHISPER_BASEURL`
     - `MEDIAMTX_BASEURL`
   - keep `PORT`, `NODE_ENV`, `ROOM_CLEANUP_TIMEOUT_MS`
   - expose derived URLs for WHIP/WHEP/RTSP if useful

2. **`src/models/types.ts` — modify**
   - add `DiscussionState.currentSpeakerActive: boolean`
   - finalize `BotStreamContext` to match Stage 2:
     - `roomId`
     - `memberId`
     - `abortController`
     - `isStreaming`
     - `accumulatedText`
   - consider extending `ChatMessage.meta` with non-mock runtime semantics such as `interrupted`

3. **New prompt-loading utility/service**
   - e.g. `src/services/prompt-service.ts`
   - responsibilities:
     - load markdown prompt files from disk
     - cache or reload safely
     - expose `getRoleplayPrompt()`, `getHintPrompt()`, `getSummaryPrompt()`

4. **New prompt assembly utility**
   - e.g. `src/services/discussion-prompt-builder.ts`
   - responsibilities:
     - build shared history template
     - filter only substantive messages (`speech`, `bot_final`)
     - append call-specific suffixes
     - inject bot persona and display name where required

### Prompt file setup
Create these repo files with placeholder but editable content:
- `prompts/roleplay-system.md`
- `prompts/hint-system.md`
- `prompts/summary-system.md`

These should exist before LLM implementation starts so the call paths and runtime file-loading contract are fixed early.

### Infrastructure/config changes
- add `.env.example` at repo root
- document all required vars and defaults
- decide one canonical env injection mechanism for compose: preferably `env_file: .env`

### Docker/env changes
- prepare compose/app service to consume `.env`
- no runtime behavior change required yet, but contract must be established now

### Frontend impact
No major UI behavior change yet. Only ensure frontend can consume any renamed state fields from websocket payloads later.

### Validation checkpoint
- config module compiles with new env names
- prompt files exist and can be read by backend at startup/runtime
- type changes compile across backend and websocket message contracts
- no Stage 1 flow regression from adding `currentSpeakerActive`

### Sequencing notes
This milestone blocks all later milestones. Do not start real LLM/audio implementation until the env names, prompt layout, and state additions are frozen.

---

## Milestone 2 — Discussion State Upgrade and Service Refactor for Stage 2 Semantics

### Goal
Refactor current discussion orchestration so it can support real speaking activity, real transcription completion, and clean bot interruption semantics.

### Major changes in this milestone
- make discussion state reflect assigned-vs-active speaker distinction
- move all Stage 2 business rules into services rather than websocket handlers
- prepare bot stream lifecycle management for AbortController-based cancellation

### Backend module breakdown

#### `src/services/discussion-service.ts` — major modification
Required changes:
- `startSpeaking()` should:
  - preserve first-speaker claim semantics from Stage 1
  - set `currentSpeakerActive = true`
  - validate only assigned current speaker may start, unless first-claim case
  - record media path if implementation stores it in discussion runtime context
- `stopSpeaking()` should:
  - require current speaker to be active
  - reset `currentSpeakerActive = false`
  - no longer generate mock transcript text internally
  - instead orchestrate downstream transcription result insertion after audio collection completes
- add or split methods if useful:
  - `finalizeHumanTurnWithTranscript(...)`
  - `assignNextSpeaker(...)`
  - `beginBotTurn(...)`
  - `completeBotTurn(...)`
- interrupt validation must now depend on `currentSpeakerActive === true`
- hint validation must depend on:
  - requester is assigned current speaker
  - `currentSpeakerActive === false`

#### `src/ws/discuss-ws.ts` — major modification
- reduce business logic in handler functions
- route operations through service layer
- ensure `discussion_state` websocket payload includes `currentSpeakerActive`
- preserve Stage 1 websocket message names unless Stage 2 explicitly changes semantics
- add clean handling for bot-stream abort path

#### New runtime context storage
Likely needed, either in:
- `discussion-service`, or
- a dedicated `runtime-store` / `stream-runtime-service`

Responsibilities:
- track active human audio collection session metadata
- track active bot stream contexts by room/member
- prevent orphan sessions during transition to summary

### Frontend impact
- `/discuss` button enablement should eventually key off `currentSpeakerActive`, not only local `isSpeaking`
- current client-local assumptions about active speaking need to become server-authoritative

### Validation checkpoint
- first-speaker claim still works
- active speaker state is distinguishable from merely assigned speaker state
- interrupt only allowed when target speaker is actively speaking
- hint only allowed before the assigned speaker starts
- websocket state remains coherent on refresh/re-entry

### Sequencing notes
This milestone should complete before implementing the real whisper/LLM integrations, because both depend on stable turn lifecycle semantics.

---

## Milestone 3 — Real Audio Pipeline Backend: mediamtx Integration and Audio Collection

### Goal
Implement the backend half of real human speaking turns: mediamtx path conventions, turn-bound audio collection, temporary file lifecycle, and room-end cleanup.

### Major changes in this milestone
- establish stable `room/{roomId}/{memberId}` stream path convention
- support server-side acquisition of a complete audio segment per human turn
- clean up all room media resources when discussion ends

### Backend module breakdown

#### New service: `src/services/media-service.ts`
Responsibilities:
- construct canonical media paths
- expose WHIP/WHEP endpoint helpers for frontend consumption if needed
- provide room-level cleanup operations for `room/{roomId}/*`
- wrap mediamtx API/config interactions if any are needed

#### New service: `src/services/audio-collection-service.ts`
Responsibilities:
- start collection when human turn starts
- stop collection when human turn ends
- return a completed audio file or file reference suitable for whisper upload
- clean up temporary files after transcription

Because Stage 2 leaves collection method flexible, implementation should explicitly pick one approach and isolate it:
- **preferred planning approach:** create a dedicated collection abstraction with one concrete strategy behind it
- do not scatter mediamtx-specific collection logic across websocket handlers

Suggested internal shape:
- `startCollection(roomId, memberId, mediaPath)`
- `stopCollection(roomId, memberId): Promise<{ filePath, mimeType }>`
- `cleanupCollection(...)`
- `cleanupRoomStreams(roomId)`

#### `src/services/discussion-service.ts` — modify
- `startSpeaking()` for human speakers should trigger audio collection start
- `stopSpeaking()` path should coordinate with audio collection stop before transcription stage

#### `src/services/room-service.ts` — modify
- `endDiscussion()` or surrounding orchestration should trigger room-wide media cleanup before or during summary transition

### Frontend changes needed
Not the full UI implementation yet, but backend contract for these values must stabilize:
- real `mediaPath` in `speaker_started`
- frontend can build WHEP URL from `MEDIAMTX_BASEURL` and `mediaPath`

### Infrastructure/config changes
- ensure mediamtx ports/protocols match Stage 2 assumptions:
  - HTTP/WHIP/WHEP on `8888`
  - RTSP on `8554`
- confirm whether a repository `mediamtx.yml` is required

### Docker/env changes
- update compose so app can reach mediamtx by service hostname using `MEDIAMTX_BASEURL`
- add `mediamtx.yml` mount if defaults are insufficient

### Testing/verification checkpoint
- when a speaker starts, backend records/starts collection for `room/{roomId}/{memberId}`
- when a speaker stops, backend can retrieve a complete audio file for that turn
- repeated turns by same member can reuse the same path without breaking collection
- room end triggers cleanup of lingering room streams/sessions

### Sequencing notes
This milestone should finish before real whisper integration, because whisper requires a valid finalized file from this pipeline.

---

## Milestone 4 — Whisper Transcription Integration

### Goal
Replace mock human transcript creation with real whisper.cpp `/inference` transcription after each human speaking turn.

### Backend module breakdown

#### New service: `src/services/whisper-service.ts`
Responsibilities:
- POST multipart audio file to `{WHISPER_BASEURL}/inference`
- always send `language=auto`
- parse `{ text }` response
- normalize transcript text
- provide fallback text on error or empty transcript

Suggested interface:
- `transcribe(filePath | fileHandle): Promise<{ text, isFallback }>`

#### `src/services/discussion-service.ts` — modify
- human stop-speaking flow should become:
  1. stop collection
  2. send file to whisper
  3. create real `ChatMessage`
  4. broadcast `message_created`
  5. clean up temp file
- fallback text should still produce a `ChatMessage`

#### `src/ws/discuss-ws.ts` — modify
- preserve ordering expectation from target state:
  - human stop
  - transcript message creation
  - `speaker_stopped`
  - state broadcast consistency
- ensure failures do not dead-end the turn lifecycle

### Frontend changes needed
- none structurally; real transcript text should render exactly where mock text rendered before

### Infrastructure/config changes
- app must use `WHISPER_BASEURL`, likely `http://whisper:8080`
- whisper service already has `--convert`; preserve that

### Docker/env changes
- app container receives `WHISPER_BASEURL`
- `.env.example` documents default value

### Testing/verification checkpoint
- a completed human turn creates a transcript-backed `ChatMessage`
- empty or failed whisper response still yields fallback message text
- temp files are deleted after processing
- discussion continues normally even on transcription failure

### Sequencing notes
This milestone depends on Milestone 3. Do not implement frontend real-audio UX as “done” until a full turn can already end in a real transcript.

---

## Milestone 5 — Unified LLM Infrastructure: Prompt Loading, History Template, and OpenAI-Compatible Client

### Goal
Build the shared LLM foundation used by bot roleplay, hint generation, and summary evaluation.

### Backend module breakdown

#### New service: `src/services/llm-service.ts`
Responsibilities:
- call OpenAI-compatible chat completion API
- support both streaming and non-streaming modes
- support AbortController for streamed calls
- select model by call type
- centralize HTTP error handling and fallback generation

Suggested capabilities:
- `streamChatCompletion(...)`
- `completeChatCompletion(...)`
- `abortStream(context)`

#### New/expanded prompt builder service
Must produce:
- shared history template
- roleplay prompt assembly with bot name + persona
- hint prompt assembly with requesting user display name
- summary prompt assembly with rubric suffix

#### Prompt file setup
All three calls must read markdown files from:
- `prompts/roleplay-system.md`
- `prompts/hint-system.md`
- `prompts/summary-system.md`

### Shared discussion history requirements to enforce
- only include substantive discussion messages
- chronological order
- speaker display names, not raw member IDs, in rendered prompt body
- same shared formatter used for all three call types

### Testing/verification checkpoint
- can load each system prompt file from disk
- prompt builder excludes system and partial streaming rows
- roleplay, hint, and summary all use the same history formatter
- config/model selection is correct per call type

### Sequencing notes
This milestone should complete before replacing any one mock service individually. It is the shared dependency for Milestones 6–8.

---

## Milestone 6 — Real Bot Turn Streaming with AbortController Cancellation

### Goal
Replace mock bot streaming with real streaming LLM roleplay generation, while preserving Stage 1 discuss flow and adding clean interruption cancellation.

### Backend module breakdown

#### Replace `src/services/bot-service.ts`
Current mock chunk service should be replaced by a real bot turn orchestration service, either by:
- rewriting the file, or
- folding bot orchestration into `llm-service` + a thin `bot-service`

Responsibilities:
- assemble bot roleplay prompt
- call LLM with `stream: true`
- forward chunks to websocket as `bot_stream`
- accumulate full text
- emit/store final `bot_final` message on completion
- preserve partial text if interrupted
- create interrupted final message when abort occurs

#### `src/ws/discuss-ws.ts` — modify
- streaming path should now consume real async stream callbacks
- on human interrupt of bot:
  - abort the active request
  - preserve accumulated text
  - finalize interrupted bot message
  - transfer speaker role to interrupter

#### `src/models/types.ts` and runtime context
- ensure `BotStreamContext.accumulatedText` exists
- store active bot stream by room/member

#### `src/services/discussion-service.ts` — modify
- bot-turn completion should count for round progression just like Stage 1
- interrupted bot turn should still produce a persisted message marked interrupted

### Frontend changes needed
Minimal rendering change because Stage 1 UI already supports visible bot stream rows. Main need is correctness:
- preserve `bot_stream` draft rendering
- replace draft with final persisted message when `message_created`/`bot_done` completes
- no UX redesign needed

### Testing/verification checkpoint
- assigned bot turn generates real streamed text
- chunks reach clients as `bot_stream`
- completed turn emits `bot_done` and creates stored `bot_final`/substantive message
- human interrupt aborts the live HTTP request
- interrupted bot text is preserved instead of lost
- next-speaker progression remains coherent after bot completion or interruption

### Sequencing notes
Depends on Milestones 2 and 5. Can proceed in parallel with frontend audio playback work once backend contracts are frozen.

---

## Milestone 7 — Real AI Hint Generation with Server-Side Validation

### Goal
Replace mock hint text with real non-streaming LLM hint generation.

### Backend module breakdown

#### Replace `src/services/hint-service.ts`
Responsibilities:
- validate current user is assigned current speaker
- validate `currentSpeakerActive === false`
- assemble hint prompt using shared history formatter
- call LLM with `stream: false`
- return ephemeral text only; do not create ChatMessage
- return fallback string on failure

#### `src/ws/discuss-ws.ts` — modify
- `ask_hint` handler should use service-layer validation
- send `hint` only to requester

### Frontend changes needed
Almost none:
- existing hint display can remain as-is
- ensure button state reflects `currentSpeakerActive` from server state

### Testing/verification checkpoint
- hint only works for assigned current speaker before speaking starts
- invalid callers are rejected server-side even if frontend state is stale
- successful call returns real LLM content
- failure returns fallback hint text without breaking discussion flow

### Sequencing notes
Depends on Milestones 2 and 5. Can be implemented independently of summary once the shared LLM layer exists.

---

## Milestone 8 — Real Summary Evaluation Streaming

### Goal
Replace mock summary streaming with real LLM evaluation while keeping deterministic rubrics from Stage 1.

### Backend module breakdown

#### Replace `src/services/summary-service.ts`
Responsibilities:
- preserve deterministic fixed rubric computation
- assemble summary prompt using shared history template + rubric suffix
- call LLM with `stream: true`
- stream chunks as `summary_stream`
- finalize `room.summary.llmSummaryText`
- on failure, set fallback summary text and still emit completion

#### `src/ws/summary-ws.ts` — modify
- `summary_fixed` remains fast/immediate
- summary LLM stream should start once per room summary lifecycle
- prevent duplicate concurrent summary streams for the same room

#### `src/services/room-service.ts` — confirm
- end-discussion flow still computes deterministic rubrics before summary streaming begins

### Frontend changes needed
Very small:
- existing summary stream rendering should work unchanged
- ensure refresh can rehydrate `llmSummaryText` if stream already partially or fully completed

### Testing/verification checkpoint
- summary page receives fixed rubrics quickly
- summary LLM text streams in real time
- `summary_done` always arrives, even on fallback path
- `room.summary.llmSummaryText` persists enough for refresh/re-entry

### Sequencing notes
Depends on Milestones 5 and on discussion message history being correct.

---

## Milestone 9 — Frontend `/discuss` Real Audio Capture and Playback

### Goal
Upgrade the discuss page from placeholder speak buttons to real browser microphone capture via WHIP and real listener playback via WHEP.

### Frontend changes needed

#### `public/js/pages/discuss.js` — major modification
Implement speaker-side behavior:
- on Start Speaking:
  - request `getUserMedia({ audio: true, video: false })`
  - create `RTCPeerConnection`
  - add audio track
  - perform WHIP negotiation to `POST {MEDIAMTX}/room/{roomId}/{memberId}/whip`
  - after connection succeeds, send `start_speaking` with real `mediaPath`
- on End Speaking:
  - close WHIP peer connection
  - stop mic track
  - send `stop_speaking`
  - show next-speaker modal

Implement listener-side behavior:
- on `speaker_started` with `mediaPath`:
  - clean up any prior playback connection
  - create WHEP peer connection
  - subscribe to `POST {MEDIAMTX}/room/{roomId}/{memberId}/whep`
  - attach received stream to exactly one active `<audio>` element
- on `speaker_stopped`:
  - close WHEP connection
  - remove audio element

#### Supporting frontend utility modules
Likely needed:
- `public/js/common/media.js` or similar
  - WHIP helper
  - WHEP helper
  - peer connection cleanup

### Backend/frontend contract notes
- frontend must not hardcode placeholder `/future/path`
- `discussion_state` should carry `currentSpeakerActive`
- `speaker_started.mediaPath` becomes authoritative

### Browser scope
- target Chromium/Chrome only
- do not widen scope to cross-browser compatibility work in this milestone

### Testing/verification checkpoint
- microphone permission request works
- current speaker can publish audio to mediamtx
- listeners hear current speaker in real time
- only one playback audio element exists at a time
- speaker switch cleans up old playback connection before new one starts
- page refresh/re-entry does not leave dangling media tracks or peer connections

### Sequencing notes
Backend audio path contract from Milestone 3 should be stable first. This frontend work can overlap with Milestones 6–8, but not before mediamtx base URL and path conventions are finalized.

---

## Milestone 10 — End-to-End Discussion End Cleanup and Infrastructure Finalization

### Goal
Finalize room-end cleanup, compose/env wiring, and repository support files so the system can be run reproducibly.

### Infrastructure/config changes

#### `docker-compose.yml` — modify
App service must receive:
- `OPENAI_BASEURL`
- `OPENAI_API_KEY`
- `ROLEPLAY_MODEL`
- `HINT_MODEL`
- `SUMMARY_MODEL`
- `WHISPER_BASEURL`
- `MEDIAMTX_BASEURL`

Recommended:
- use `env_file: .env`
- keep `PORT`, `NODE_ENV` where needed

#### `.env.example` — create
Document:
- all required Stage 2 variables
- defaults for base URLs and models
- note that API key must be filled by user

#### `mediamtx.yml` — create if required
Only if defaults are insufficient. Purpose:
- ensure WHIP enabled
- ensure WHEP enabled
- ensure RTSP exposed
- no auth for prototype

### Backend service changes
- on discussion end:
  - abort any active bot stream
  - stop/cleanup active audio collection sessions
  - release mediamtx room streams
  - then transition cleanly to summary
- ensure summary room cleanup logic from Stage 1 still works after Stage 2 additions

### Frontend changes needed
- ensure page unload/transition closes media peer connections in addition to websocket connections
- summary reset behavior remains unchanged

### Testing/verification checkpoint
- full docker compose boot works with app + whisper + mediamtx
- app can resolve service hostnames internally
- ending discussion while media/LLM work is active does not leave orphan tasks
- room transitions to summary cleanly after cleanup
- summary auto-destruction after heartbeat loss still works

### Sequencing notes
This milestone should occur after the major real integrations are in place, because cleanup behavior must account for actual runtime resources.

---

## Milestone 11 — Stage 2 Integration Verification and Acceptance Testing

### Goal
Verify the delivered system against the Stage 2 acceptance criteria, not just isolated module behavior.

### End-to-end verification scenarios

1. **Human speech turn with real audio + real transcript**
   - user starts speaking
   - audio publishes via WHIP
   - others hear via WHEP
   - user ends speaking
   - whisper transcript appears as chat message

2. **Bot real streaming turn**
   - next speaker is bot
   - bot streams visible chunks
   - final bot message is stored and displayed

3. **Human interrupts bot**
   - bot is actively streaming
   - human interrupt triggers AbortController cancellation
   - partial bot text is preserved as interrupted message
   - human becomes active speaker

4. **Human interrupts human**
   - current human speaker is active
   - valid interrupter requests interrupt
   - accept/reject flow still works

5. **Hint validation path**
   - assigned speaker before starting can request hint
   - non-speaker or already-started speaker cannot

6. **Summary evaluation**
   - discussion ends
   - mediamtx cleanup occurs
   - summary fixed rubrics appear
   - LLM evaluation streams

7. **Failure fallback paths**
   - whisper failure still creates fallback speech message
   - bot LLM failure still creates fallback bot message
   - hint failure still returns fallback hint
   - summary failure still finishes with fallback summary text

8. **Refresh/re-entry**
   - discuss refresh preserves correct room routing and state
   - summary refresh preserves summary text/rubrics

### Acceptance gate
Do not mark Stage 2 complete until all Stage 2 acceptance criteria in `docs/final-target-state-stage2.md` are satisfied.

---

## 5. Backend Module Breakdown Summary

## New backend services likely required
- `src/services/prompt-service.ts`
- `src/services/discussion-prompt-builder.ts`
- `src/services/llm-service.ts`
- `src/services/media-service.ts`
- `src/services/audio-collection-service.ts`
- `src/services/whisper-service.ts`
- possibly `src/services/runtime-stream-service.ts` or equivalent for active bot/audio session tracking

## Existing backend services requiring major modification
- `src/config/index.ts`
- `src/models/types.ts`
- `src/services/discussion-service.ts`
- `src/services/bot-service.ts`
- `src/services/hint-service.ts`
- `src/services/summary-service.ts`
- `src/services/room-service.ts`
- `src/ws/discuss-ws.ts`
- `src/ws/summary-ws.ts`

## Existing modules likely needing minor contract updates
- websocket message typing files
- room-state response payload assembly
- cleanup/liveness logic where summary-phase destruction intersects with active Stage 2 runtime tasks

---

## 6. Frontend Change Summary

## `/discuss`
Required changes:
- real microphone capture
- WHIP publish negotiation
- WHEP playback subscription
- peer connection lifecycle cleanup
- active audio element management
- button-state logic tied to `currentSpeakerActive`
- preserve existing message rendering for transcripts and bot streaming

## `/summary`
Required changes:
- mostly unchanged UI
- ensure robust rehydration of streamed/final summary text
- no redesign required

## Shared frontend utilities
Likely additions:
- media/WebRTC helper module
- maybe env/config exposure if backend serves mediamtx base URL to frontend or embeds it in page script config

---

## 7. Prompt File Setup

The following files must exist before LLM features are considered complete:
- `prompts/roleplay-system.md`
- `prompts/hint-system.md`
- `prompts/summary-system.md`

Implementation guidance:
- placeholder content is acceptable initially
- file existence and runtime loading are mandatory
- prompts should be editable without code changes
- history templating logic must be code-based and shared, not duplicated per service

---

## 8. Docker / Env Changes Summary

## Required `.env` variables
- `OPENAI_BASEURL`
- `OPENAI_API_KEY`
- `ROLEPLAY_MODEL`
- `HINT_MODEL`
- `SUMMARY_MODEL`
- `WHISPER_BASEURL`
- `MEDIAMTX_BASEURL`
- optional existing operational vars such as `PORT`, `NODE_ENV`, `ROOM_CLEANUP_TIMEOUT_MS`

## Compose changes
- app service should consume `.env`
- whisper service can stay largely unchanged
- mediamtx service may need explicit config mounting

## Repository support files
- `.env.example`
- `prompts/*.md`
- `mediamtx.yml` if defaults are not enough

---

## 9. Explicit Dependency / Sequencing Advice

## Hard dependencies
- **Milestone 1** blocks everything else
- **Milestone 2** blocks correct implementation of hint validation, interrupt validation, and bot stream cancellation semantics
- **Milestone 3** blocks real whisper integration
- **Milestone 5** blocks bot/hint/summary LLM replacement work
- **Milestone 10** should wait until real runtime resources exist

## Safe parallel work
After Milestone 1:
- backend state/service refactor (Milestone 2)
- prompt file drafting and prompt-loader implementation
- docker/env scaffolding updates

After Milestones 2 and 5:
- bot integration (Milestone 6)
- hint integration (Milestone 7)
- summary integration (Milestone 8)

After Milestone 3 contract stabilization:
- frontend real-audio work (Milestone 9)

## Recommended serial path
1. M1
2. M2
3. M3
4. M4 + M5 (can overlap partially)
5. M6 + M7 + M8
6. M9
7. M10
8. M11

---

## 10. Risks and Mitigation

## Risk 1 — Audio collection method uncertainty in mediamtx
### Problem
Stage 2 intentionally leaves collection method open.
### Mitigation
Choose one method early in Milestone 3 and isolate it behind `audio-collection-service`. Do not leak collection-strategy details into websocket handlers.

## Risk 2 — Frontend media handshake complexity destabilizes discussion flow
### Problem
WHIP/WHEP browser integration is more failure-prone than Stage 1 mocks.
### Mitigation
Keep page-state logic separate from media transport helper code. Treat websocket state as authoritative and media connection as a managed side effect.

## Risk 3 — Bot interruption can leak HTTP streams
### Problem
If AbortController is not wired end-to-end, interrupted bot turns may leave orphan requests.
### Mitigation
Centralize all streamed LLM calls in `llm-service`; never stream directly from websocket handlers.

## Risk 4 — Hint/button enablement drift between frontend and backend
### Problem
The current frontend still relies partly on local `isSpeaking` assumptions.
### Mitigation
Make `currentSpeakerActive` part of the canonical discussion-state payload and enforce validation server-side regardless of button state.

## Risk 5 — Summary/start/end cleanup race conditions
### Problem
Discussion may end while bot/audio tasks are still active.
### Mitigation
Define one room-level shutdown sequence: abort bot stream → stop collection → cleanup mediamtx room resources → transition/broadcast summary.

## Risk 6 — Prompt formatting divergence between bot/hint/summary
### Problem
If each service hand-builds its own history text, behavior will drift from target state.
### Mitigation
Use one shared prompt builder and keep suffix logic as thin wrappers.

## Risk 7 — Config drift from target env names
### Problem
Current code already uses different variable names.
### Mitigation
Fix env contract first in Milestone 1 and reject partial compatibility layers unless truly needed for migration.

---

## 11. Completion Standard

Stage 2 planning should be considered executed only when implementation completes all milestones above and the system demonstrably satisfies the Stage 2 target state, especially:
- real WHIP/WHEP audio
- real whisper transcription
- real roleplay/hint/summary LLM calls
- bot cancellation via AbortController
- prompt files on disk
- `.env.example` and compose wiring
- room-end mediamtx cleanup
- graceful fallback behavior under whisper/LLM failure

If implementation convenience conflicts with `docs/final-target-state-stage2.md`, the implementation must not silently drift; the target-state document must be revised explicitly first.