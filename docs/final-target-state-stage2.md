# Final Target State Document — Stage 2

## 1. Document Purpose

This document is the authoritative final target state for Stage 2 of the CPT208 project.

Stage 1 delivered a low-fidelity prototype with mock discussion behavior, mock bot streaming, mock AI hints, and mock summary evaluation. All page flows, room lifecycle, websocket coordination, and state machine behavior were validated in Stage 1.

Stage 2 replaces every mock seam with real infrastructure:

- **real audio capture and relay** through mediamtx via WHIP/WHEP
- **real speech transcription** through whisper.cpp
- **real LLM-powered bot turns** through an OpenAI-compatible API
- **real LLM-powered AI hints** through an OpenAI-compatible API
- **real LLM-powered summary evaluation** through an OpenAI-compatible API

This document defines the intended end state for Stage 2. It supersedes Stage 1 mock behavior where specified but preserves all Stage 1 page flow, room lifecycle, websocket protocol, and state machine semantics unless explicitly changed here.

If implementation later reveals gaps or contradictions, this document must be revised explicitly rather than worked around informally.

---

## 2. Stage 2 Scope

### 2.1 In Scope

1. Browser microphone capture and push to mediamtx via WHIP protocol.
2. Real-time audio relay from mediamtx to other room members' browsers via WHEP protocol.
3. Audio-only transmission; no video.
4. Server-side collection of a speaker's full audio segment from mediamtx during their speaking turn.
5. Batch transcription of collected audio via whisper.cpp `/inference` endpoint after a speaking turn ends.
6. Real LLM-powered bot turn generation using OpenAI-compatible chat completion API with streaming.
7. Real LLM-powered AI hint generation using OpenAI-compatible chat completion API.
8. Real LLM-powered summary evaluation using OpenAI-compatible chat completion API with streaming.
9. AbortController-based cancellation of bot streaming when a human interrupts.
10. Proper cleanup of all mediamtx streams when discussion ends and room transitions to summary phase.
11. Environment-based configuration for all external service URLs and LLM model names.
12. Configurable system prompts stored as server-side markdown files.
13. A shared discussion-history prompt template used by all three LLM call types.

### 2.2 Explicitly Out of Scope

1. Real-time/streaming transcription during speech (batch only).
2. Video transmission.
3. Persistent storage/database.
4. Real authentication.
5. Mobile-responsive optimization.
6. Advanced production fault tolerance beyond basic retry/error handling.
7. Multi-turn LLM conversation state (each LLM call is a single-turn completion).
8. LLM tool calling / function calling.
9. Language selection per room (always `auto` for whisper, always the same system prompt language direction).

### 2.3 Important Boundary Decisions

- **Transcription is batch-only**: no chunked/streaming whisper calls during speech. This avoids word-boundary corruption from mid-word slicing.
- **LLM calls are single-turn**: each bot turn, hint request, and summary evaluation is an independent completion call with the full discussion history as context. No conversation threading.
- **Topic is emergent**: there is no explicit "discussion topic" field. The topic emerges from the first speaker's content, which the LLM naturally reads from the discussion history.
- **No FFmpeg container needed**: whisper.cpp's `--convert` flag can handle opus input directly, eliminating the need for a separate FFmpeg conversion step.

---

## 3. Audio Pipeline Architecture

## 3.1 Overview

```
Browser (Speaker)                  Server                      Browser (Listeners)
      |                              |                                |
      | getUserMedia(audio)          |                                |
      | WHIP POST -----> mediamtx    |                                |
      | Opus/WebRTC stream           |                                |
      |                              |                                |
      |            mediamtx records  |                                |
      |            the full segment  |                                |
      |                              |                                |
      |              WHEP ----------+|-------> play audio via <audio> |
      |                              |                                |
      | (speaker ends turn)          |                                |
      | ---- stop_speaking ---->     |                                |
      |                              | collect segment from mediamtx  |
      |                              | send opus to whisper /inference |
      |                              | receive transcript text         |
      |                              | create ChatMessage              |
      |                              | broadcast message_created       |
```

## 3.2 WHIP: Browser → mediamtx

When a human user starts speaking:

1. Frontend calls `navigator.mediaDevices.getUserMedia({ audio: true, video: false })`.
2. Frontend creates an `RTCPeerConnection`.
3. Frontend adds the audio track to the connection.
4. Frontend sends a WHIP HTTP POST to mediamtx to negotiate WebRTC.
5. Audio is pushed to mediamtx as Opus-encoded WebRTC stream.
6. The mediamtx path for this stream is: `room/{roomId}/{memberId}`.
7. Frontend notifies the server via `/api/ws/discuss` that it has started speaking, including the media path.

### WHIP Endpoint

The WHIP endpoint on mediamtx is:

```
POST http://{MEDIAMTX_HOST}:8888/room/{roomId}/{memberId}/whip
```

The mediamtx configuration must have WHIP enabled on port 8888.

### Stream Path Convention

Every speaker's stream follows the path pattern:

```
room/{roomId}/{memberId}
```

For example, if `roomId = R12345` and `memberId = m_abc`, the stream path is `room/R12345/m_abc`.

This convention:
- groups all streams for a room under a common prefix
- makes it easy to find/clean up all streams for a room
- ensures each member has a stable, predictable path (used by both WHIP push and WHEP pull)

## 3.3 WHEP: mediamtx → Browser

When a human user is listening (not the current speaker):

1. Frontend creates an `RTCPeerConnection`.
2. Frontend sends a WHEP HTTP POST to mediamtx for the current speaker's path.
3. mediamtx streams the current speaker's audio to the listener.
4. Frontend plays the audio through an `<audio>` element or `MediaStream`.

### WHEP Endpoint

The WHEP endpoint on mediamtx is:

```
POST http://{MEDIAMTX_HOST}:8888/room/{roomId}/{memberId}/whep
```

Where `{roomId}/{memberId}` identifies the current speaker.

## 3.4 Stream Lifecycle

### Start of Speech Turn

When a human user starts speaking:

1. Frontend establishes WHIP connection to `room/{roomId}/{memberId}`.
2. Frontend sends `start_speaking` via discuss websocket with `mediaPath: "room/{roomId}/{memberId}"`.
3. Server broadcasts `speaker_started` with the `mediaPath` to all other room members.
4. Other members' frontends subscribe to the WHEP endpoint for that `mediaPath` and play the audio.

### During Speech Turn

- The speaker's browser continuously pushes Opus audio to mediamtx.
- mediamtx relays the audio to all WHEP subscribers in real time.
- The server does not need to actively process the audio stream during the turn.

### End of Speech Turn

When a human user stops speaking:

1. Frontend closes the WHIP connection.
2. Frontend sends `stop_speaking` via discuss websocket.
3. Server must collect the complete audio segment from mediamtx for this speaker's turn.
4. All listeners' frontends close their WHEP connections for this speaker's path.
5. Server sends the collected audio to whisper.cpp for transcription.
6. Server creates a `ChatMessage` with the transcript text.
7. Server broadcasts `message_created` and `speaker_stopped`.

### End of Discussion

When the owner ends the discussion and the room transitions to summary phase:

1. Server must ensure all remaining mediamtx streams for this room are cleaned up.
2. Any still-open WHIP/WHEP sessions should be terminated.
3. mediamtx stream paths under `room/{roomId}/*` should be released.

This cleanup is required even if no one is currently speaking, because lingering streams from incomplete turns or edge cases could otherwise persist.

### Stream Path Reuse

Because stream paths are keyed by `room/{roomId}/{memberId}`, the same path is reused each time the same member speaks. This is intentional:

- When a member starts speaking again in a later round, the same path is used for a new WHIP session.
- There is no need to clean up and recreate the path between turns within the same discussion.
- Cleanup only happens at discussion end.

---

## 4. Transcription Pipeline

## 4.1 Audio Collection Strategy

When a human speaker finishes their turn, the server needs the complete audio for that turn to send to whisper.

### Collection Method

The server should collect the speaker's audio from mediamtx. There are several possible approaches:

#### Option A: mediamtx Recording API

mediamtx may support recording streams to disk. If so:
1. When a speaker starts, server requests mediamtx to begin recording `room/{roomId}/{memberId}`.
2. When the speaker stops, server requests mediamtx to stop recording.
3. Server reads the recorded file and sends it to whisper.

#### Option B: Server-Side RTSP Pull

mediamtx exposes RTSP on port 8554. The server could:
1. When a speaker starts, begin pulling audio from `rtsp://{MEDIAMTX_HOST}:8554/room/{roomId}/{memberId}`.
2. Buffer the audio in memory.
3. When the speaker stops, save the buffered audio to a temporary file and send to whisper.

#### Option C: mediamtx HTTP API / Proxy

mediamtx's HTTP API (port 8888) may provide stream access or segment download.

### Implementation Freedom

The exact collection method is left as implementation freedom, as long as:
- the server can obtain a complete opus audio file for each speaking turn
- the file can be sent to whisper's `/inference` endpoint
- the file is cleaned up after processing

### Important Note

Because whisper.cpp with `--convert` can handle opus input directly, there is no need for FFmpeg-based conversion to WAV. The server can send the collected opus audio directly to whisper.

## 4.2 Whisper API Contract

### Endpoint

```
POST http://{WHISPER_HOST}:8080/inference
Content-Type: multipart/form-data
```

### Request

| Field | Type | Description |
|-------|------|-------------|
| file | file | Audio file (WAV, MP3, Opus, etc. — whisper `--convert` handles format conversion) |
| language | string | Always `auto` |

### Response

```json
{
  "text": "Transcribed text of the speech turn\n"
}
```

### Error Handling

If whisper returns an error or empty transcript:
- Server should still create a ChatMessage, possibly with a fallback text like `[Speech could not be transcribed]`.
- The discussion flow should not break due to a transcription failure.

---

## 5. LLM Integration Architecture

## 5.1 Configuration

All LLM configuration is provided via environment variables, loaded from a `.env` file.

### Required Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `OPENAI_BASEURL` | Base URL for OpenAI-compatible API | `https://zenmux.ai/api/v1` |
| `OPENAI_API_KEY` | API key for the LLM service | (required, no default) |
| `ROLEPLAY_MODEL` | Model used for bot roleplay turns | `minimax/minimax-m2-her` |
| `HINT_MODEL` | Model used for AI hint generation | `stepfun/step-3.5-flash` |
| `SUMMARY_MODEL` | Model used for discussion evaluation | `moonshotai/kimi-k2.5` |

### `.env.example` File

A `.env.example` file must exist in the repository root with all variables documented and their defaults shown. Users copy this to `.env` and fill in their API key.

### Docker Integration

The `docker-compose.yml` must pass these environment variables into the app container, either via `env_file: .env` or explicit `environment` entries.

## 5.2 System Prompts

System prompts are stored as markdown files on the server. This allows easy editing without code changes.

### File Locations

| File | Purpose |
|------|---------|
| `prompts/roleplay-system.md` | System prompt for bot roleplay turns |
| `prompts/hint-system.md` | System prompt for AI hint generation |
| `prompts/summary-system.md` | System prompt for summary evaluation |

### Content Requirements

Each file should contain a markdown document that instructs the LLM about:
- the context: this is an XJTLU-style group discussion
- the norms: discussion rules, turn-taking, etc.
- the role: what the LLM is expected to produce

### Initial Placeholder Content

The initial content of these files should be reasonable placeholder text that can be replaced later. The structure and file-loading mechanism must be implemented even if the prompt content is still draft.

## 5.3 Shared Discussion History Template

All three LLM call types share a common discussion-history template that formats the current discussion messages into a user prompt.

### Template Format

```
以下是本轮小组讨论当前的所有消息：

XXX（用户UUID或bot名字）：
说话内容

XXX（用户UUID或bot名字）：
说话内容

……
```

Where:
- `XXX` is replaced by the speaker's `displayName`
- Each message's `text` field is used as the speech content
- Messages are listed in chronological order
- Only messages of type `speech`, `bot_final`, or equivalent substantive types are included (not system messages)

### Suffix by Call Type

After the shared history template, each call type appends its own suffix:

| Call Type | Suffix |
|-----------|--------|
| Roleplay | `请仅给出本轮你的发言：` |
| Hint | `请针对当前发言的 XXX 同学，给出一组恰当的提纲性发言建议：` (where XXX is the requesting user's display name) |
| Summary | `现在这场小组讨论已经结束了。评价一场小组讨论的标准为：…… 请对本次讨论给出你的评价：` (with rubric criteria filled in) |

## 5.4 Bot Roleplay Call

### When

When it is a bot member's turn to speak.

### Request Structure

```
POST {OPENAI_BASEURL}/chat/completions
```

```json
{
  "model": "{ROLEPLAY_MODEL}",
  "stream": true,
  "messages": [
    {
      "role": "system",
      "content": "<contents of prompts/roleplay-system.md>"
    },
    {
      "role": "user",
      "content": "<shared history template> + <bot persona description> + 请仅给出本轮你的发言："
    }
  ]
}
```

### Bot Persona in Prompt

The bot's `botProfile.persona` field should be included in the user prompt so the LLM knows what role/personality to adopt. For example:

```
你的角色设定：{botProfile.persona}
```

This should be placed before the suffix line.

### Streaming Behavior

- Response must be streamed (`stream: true`).
- Each chunk is forwarded to clients via `bot_stream` websocket message.
- When the stream completes, a `bot_done` message is sent with the full accumulated text.
- A `ChatMessage` of type `bot_final` is created and stored in discussion state.

### Cancellation

If a human user interrupts the bot:
- Server uses `AbortController` to cancel the ongoing stream.
- The partial text is preserved as a `ChatMessage` marked as interrupted.
- The bot does not reject interruption.

### Bot Name in Prompt

The bot's `displayName` should be communicated to the LLM so it knows its own name. This can be part of the persona description or a separate line in the prompt.

## 5.5 AI Hint Call

### When

When a human user who is the assigned current speaker (and has not yet started speaking) presses the AI Hint button.

### Request Structure

```json
{
  "model": "{HINT_MODEL}",
  "stream": false,
  "messages": [
    {
      "role": "system",
      "content": "<contents of prompts/hint-system.md>"
    },
    {
      "role": "user",
      "content": "<shared history template> + 请针对当前发言的 XXX 同学，给出一组恰当的提纲性发言建议："
    }
  ]
}
```

### Response

- Non-streaming response.
- The `choices[0].message.content` is sent to the requesting user via `hint` websocket message.
- No ChatMessage is created for hints; they are ephemeral suggestions visible only to the requesting user.

### Server-Side Validation

The server must validate that the requesting user is the assigned current speaker and has not yet started speaking before making the LLM call. This aligns with the frozen button enablement rules.

## 5.6 Summary Evaluation Call

### When

When discussion ends and the room transitions to summary phase.

### Request Structure

```json
{
  "model": "{SUMMARY_MODEL}",
  "stream": true,
  "messages": [
    {
      "role": "system",
      "content": "<contents of prompts/summary-system.md>"
    },
    {
      "role": "user",
      "content": "<shared history template> + 现在这场小组讨论已经结束了。评价一场小组讨论的标准为：…… 请对本次讨论给出你的评价："
    }
  ]
}
```

### Rubric Criteria in Prompt

The rubric criteria mentioned in the suffix should include at minimum:

- whether the first speaker's opening effectively introduced the topic
- whether the last speaker's closing effectively summarized the discussion
- whether each participant's initial stance was clear and whether views shifted toward consensus
- whether the discussion stayed on topic
- any other criteria the school uses for evaluation

### Streaming Behavior

- Response must be streamed.
- Each chunk is forwarded to clients via `summary_stream` websocket message.
- When the stream completes, a `summary_done` message is sent.
- The full text is stored in `room.summary.llmSummaryText`.

### Fixed Rubrics

Fixed deterministic rubrics (`everyoneSpoke`, `hasValidInterruption`, `leaderSameAsLastSpeaker`, `leaderMemberId`) are computed by the server's state machine as before and sent via `summary_fixed`. The LLM evaluation is supplementary, not a replacement for these deterministic results.

## 5.7 Error Handling for LLM Calls

If any LLM call fails:
- Bot turn: create a fallback ChatMessage with text like `[Bot failed to generate a response]` and continue the discussion flow.
- Hint: send a fallback hint text like `[Could not generate a hint at this time]` to the requesting user.
- Summary: send a fallback summary text like `[Could not generate evaluation]` and mark the summary as done.

The discussion flow must not break due to LLM failures.

## 5.8 AbortController Integration

### Bot Streaming Cancellation

When a bot is streaming and a human user interrupts:

1. Server receives `interrupt_request` via discuss websocket.
2. Server calls `abortController.abort()` on the ongoing bot streaming request.
3. Server creates a `ChatMessage` with whatever text was accumulated before the abort, marked as interrupted.
4. Server handles the interrupt as normal (interrupter becomes new speaker).

### Implementation Requirement

The bot streaming implementation must use `AbortController` or an equivalent mechanism so that:
- the HTTP connection to the LLM API is properly closed on abort
- no orphaned connections or resource leaks occur
- the abort is handled cleanly without crashing the server

---

## 6. Page Changes from Stage 1

## 6.1 `/discuss` — Audio Controls

The `/discuss` page must now support real audio capture and playback.

### Speech Input Button Behavior

When the current speaker presses "Start Speaking":

1. Request microphone permission via `navigator.mediaDevices.getUserMedia({ audio: true, video: false })`.
2. Create `RTCPeerConnection`.
3. Add audio track to the connection.
4. Send WHIP POST to mediamtx at the speaker's stream path.
5. Send `start_speaking` via discuss websocket with `mediaPath`.
6. Button changes to "End Speaking".

When the speaker presses "End Speaking":

1. Close the WHIP connection / `RTCPeerConnection`.
2. Stop the microphone track.
3. Send `stop_speaking` via discuss websocket.
4. Show next-speaker selection modal.

### Audio Playback for Listeners

When a listener receives `speaker_started` with a `mediaPath`:

1. Create `RTCPeerConnection`.
2. Send WHEP POST to mediamtx for the given `mediaPath`.
3. Attach the received `MediaStream` to an `<audio>` element for playback.
4. When `speaker_stopped` is received, close the WHEP connection and remove the audio element.

### Audio Element Management

- There should be at most one active audio playback element at a time (for the current speaker).
- When the speaker changes, the old audio element should be cleaned up before subscribing to the new speaker's WHEP endpoint.

### Browser Compatibility

Target browser: Chrome (Chromium-based). No need to support other browsers in this milestone.

## 6.2 `/discuss` — Message Display

Transcribed messages from real whisper output should be displayed the same way as mock messages were in Stage 1. The only difference is that the `text` field now contains real transcript content.

Bot messages from real LLM streaming should also be displayed the same way. The streaming behavior is now real but the UI rendering remains the same as the Stage 1 mock.

---

## 7. Backend Service Changes

## 7.1 New Services

### Audio Collection Service

A service responsible for:

- Starting audio collection from mediamtx when a speaker begins their turn.
- Stopping collection when the speaker ends their turn.
- Providing the collected audio file for whisper transcription.
- Cleaning up temporary audio files after processing.

### Whisper Service (replacing mock)

A service responsible for:

- Sending audio files to the whisper.cpp `/inference` endpoint.
- Parsing the transcript response.
- Handling errors gracefully with fallback text.

### LLM Service (replacing mock bot, hint, and summary services)

A service responsible for:

- Making OpenAI-compatible chat completion API calls.
- Handling streaming responses for bot turns and summary evaluation.
- Handling non-streaming responses for hints.
- Supporting `AbortController` for bot turn cancellation.
- Reading system prompts from markdown files on disk.
- Formatting discussion history into the shared template.
- Selecting the correct model based on call type.

## 7.2 Modified Services

### Discussion Service

- `startSpeaking()` must now also trigger audio collection for human speakers.
- `stopSpeaking()` must now also stop audio collection, trigger whisper transcription, and create a ChatMessage with the real transcript.
- Bot turn handling must now trigger real LLM streaming instead of mock text generation.

### Summary Service

- Must now trigger real LLM evaluation streaming instead of mock chunk progression.
- Must use the `SUMMARY_MODEL` and `prompts/summary-system.md`.

### Hint Service

- Must now trigger real LLM hint generation instead of returning mock text.
- Must use the `HINT_MODEL` and `prompts/hint-system.md`.
- Must validate that the requester is the assigned current speaker who has not yet started speaking.

## 7.3 Configuration Changes

The backend configuration must now load:

- `OPENAI_BASEURL`
- `OPENAI_API_KEY`
- `ROLEPLAY_MODEL`
- `HINT_MODEL`
- `SUMMARY_MODEL`
- `WHISPER_BASEURL` (e.g., `http://whisper:8080`)
- `MEDIAMTX_BASEURL` (e.g., `http://mediamtx:8888`)

These should be available via environment variables and/or the existing config module.

---

## 8. Docker and Infrastructure Changes

## 8.1 docker-compose.yml

The existing compose file already declares `whisper` and `mediamtx`. Changes needed:

1. **app service** must receive environment variables:
   - `OPENAI_BASEURL`
   - `OPENAI_API_KEY`
   - `ROLEPLAY_MODEL`
   - `HINT_MODEL`
   - `SUMMARY_MODEL`
   - `WHISPER_BASEURL`
   - `MEDIAMTX_BASEURL`
   - Via `env_file: .env` or explicit `environment` entries.

2. **whisper service** already has `--convert` flag. No further changes needed.

3. **mediamtx service** must have WHIP and WHEP enabled. This may require a mediamtx configuration file or command-line flags to ensure:
   - WHIP endpoint is available on port 8888
   - WHEP endpoint is available on port 8888
   - RTSP is available on port 8554
   - No authentication is required for WHIP/WHEP (suitable for prototype)

## 8.2 mediamtx Configuration

mediamtx may need a configuration file to enable WHIP/WHEP and set appropriate defaults. If the default configuration already enables these protocols, no additional file is needed.

If a configuration file is needed, it should be placed at `mediamtx.yml` in the repository root and mounted into the mediamtx container.

## 8.3 New Files in Repository

| File | Purpose |
|------|---------|
| `.env.example` | Template for environment variable configuration |
| `prompts/roleplay-system.md` | System prompt for bot roleplay |
| `prompts/hint-system.md` | System prompt for AI hints |
| `prompts/summary-system.md` | System prompt for summary evaluation |
| `mediamtx.yml` (if needed) | mediamtx configuration |

## 8.4 No New Containers

No FFmpeg container is needed because whisper.cpp `--convert` handles opus input directly.

No LLM container is needed because we use a cloud-based OpenAI-compatible API.

---

## 9. Prompt Template Specification

## 9.1 Shared Discussion History Format

The shared template formats all discussion messages as:

```
以下是本轮小组讨论当前的所有消息：

{displayName1}：
{message1.text}

{displayName2}：
{message2.text}

……

```

### Rules

- Only messages of type `speech` and `bot_final` are included.
- System messages and `bot_stream` partial messages are excluded.
- Messages are ordered by `createdAt` ascending.
- If no messages exist yet, the template still includes the header line but has no message entries.

## 9.2 Roleplay Prompt Assembly

```
[system: contents of prompts/roleplay-system.md]

[user:
以下是本轮小组讨论当前的所有消息：

{messages}

你的名字是：{bot.displayName}
你的角色设定：{bot.botProfile.persona}

请仅给出本轮你的发言：
]
```

## 9.3 Hint Prompt Assembly

```
[system: contents of prompts/hint-system.md]

[user:
以下是本轮小组讨论当前的所有消息：

{messages}

请针对当前发言的 {user.displayName} 同学，给出一组恰当的提纲性发言建议：
]
```

## 9.4 Summary Prompt Assembly

```
[system: contents of prompts/summary-system.md]

[user:
以下是本轮小组讨论当前的所有消息：

{messages}

现在这场小组讨论已经结束了。评价一场小组讨论的标准为：
- 首次发言是否起到了总起和引入话题的作用
- 末次发言是否起到了总结收束的作用
- 每个人的初始观点是什么，讨论过程中观点是否发生了偏移以达成共识
- 讨论是否偏离主题
- 是否有合理的打断
- 所有人是否都参与了发言

请对本次讨论给出你的评价：
]
```

---

## 10. WebSocket Protocol Changes from Stage 1

The websocket protocol is largely unchanged from Stage 1. The key differences are:

## 10.1 `speaker_started`

The `mediaPath` field now contains a real mediamtx stream path instead of a placeholder.

```json
{
  "type": "speaker_started",
  "data": {
    "memberId": "m_xxx",
    "displayName": "u_123",
    "mediaPath": "room/R12345/m_xxx"
  }
}
```

Frontend uses this `mediaPath` to construct the WHEP URL for audio playback.

## 10.2 `message_created`

For human speech turns, the `text` field now contains real whisper transcript output instead of mock text.

For bot turns, the `text` field now contains real LLM output instead of mock text.

## 10.3 `hint`

The `text` field now contains real LLM-generated hint text instead of mock text.

## 10.4 `bot_stream` and `bot_done`

These now carry real LLM streaming chunks and final text instead of mock data.

## 10.5 `summary_stream` and `summary_done`

These now carry real LLM streaming evaluation output instead of mock data.

## 10.6 `discussion_ended`

On discussion end, the server must now also clean up all mediamtx streams for the room.

---

## 11. State Model Changes

## 11.1 DiscussionState Addition

A new field tracks whether the current speaker has actively started speaking (as opposed to merely being assigned):

```ts
type DiscussionState = {
  // ... existing fields ...
  currentSpeakerActive: boolean;  // true after start_speaking is processed
}
```

This field enables:
- server-side validation that interrupt is only allowed when `currentSpeakerActive === true`
- server-side validation that hint is only allowed when the user is the assigned speaker AND `currentSpeakerActive === false`

### Semantics

- `currentSpeakerActive = false` when a speaker is assigned but has not yet sent `start_speaking`.
- `currentSpeakerActive = true` after `start_speaking` is processed.
- `currentSpeakerActive` is reset to `false` when the speaker stops speaking or is interrupted.
- `currentSpeakerActive` is included in `discussion_state` websocket messages so the frontend can align button states.

## 11.2 Bot Streaming State

The bot streaming implementation must track:

```ts
type BotStreamContext = {
  roomId: string;
  memberId: string;
  abortController: AbortController;
  isStreaming: boolean;
  accumulatedText: string;
}
```

This replaces the Stage 1 mock streaming context.

---

## 12. Acceptance Criteria for Stage 2

The Stage 2 milestone is complete only if the delivered system satisfies all of the following:

1. A human user can start speaking and their audio is pushed to mediamtx via WHIP.
2. Other room members can hear the current speaker's audio in real time via WHEP.
3. When a human user stops speaking, their audio is transcribed by whisper.cpp and a ChatMessage with the transcript is created.
4. When it is a bot's turn, the bot generates speech using the real LLM API (ROLEPLAY_MODEL) with streaming, and the streamed text is visible on the discuss page.
5. A human user can interrupt a bot's streaming turn, causing the stream to be cancelled via AbortController.
6. A human user can interrupt another human's speaking turn, and the accept/reject modal appears for the current speaker.
7. The AI Hint button triggers a real LLM call (HINT_MODEL) and the suggestion is displayed to the user.
8. The AI Hint button is only functional when the user is the assigned current speaker and has not yet started speaking (enforced server-side).
9. When discussion ends, the summary evaluation is generated by the real LLM (SUMMARY_MODEL) with streaming.
10. Deterministic rubric results are still computed by the state machine and displayed alongside the LLM evaluation.
11. All mediamtx streams for a room are cleaned up when discussion ends.
12. Environment variables for LLM configuration are loaded from `.env` and passed through docker-compose.
13. `.env.example` exists in the repository root with all required variables documented.
14. System prompt markdown files exist under `prompts/` and are loaded by the server at runtime.
15. All Stage 1 acceptance criteria that are not explicitly changed still hold.
16. The discussion flow does not break if whisper or LLM calls fail; fallback text is provided.
17. The shared discussion history template is used consistently across all three LLM call types.

---

## 13. Known Uncertainties That Do Not Block Implementation

1. The exact mediamtx audio collection method (recording API vs RTSP pull vs other) is implementation freedom.
2. The exact content of the three system prompt markdown files is draft and may be revised.
3. The exact rubric criteria in the summary prompt suffix may be expanded or refined.
4. Whether mediamtx requires explicit configuration for WHIP/WHEP or works with defaults.
5. The exact error messages for LLM/whisper failures.
6. Whether `currentSpeakerActive` should also be sent in `discussion_state` for frontend consumption (recommended yes, but exact field name is implementation freedom).

---

## 14. Final Instruction to Downstream Agents

Any planner, implementer, or reviewer working on Stage 2 must treat this document as the authoritative target state for Stage 2.

Stage 1's `docs/final-target-state.md` remains authoritative for all behavior not explicitly changed by this document.

If implementation convenience conflicts with this document, implementation must not silently drift. Either:

- follow this document, or
- explicitly revise this document first through orchestration.
