(function() {
  const currentSpeakerName = document.getElementById('current-speaker-name');
  const speakingIndicator = document.getElementById('speaking-indicator');
  const roundBadge = document.getElementById('round-badge');
  const endDiscussionBtn = document.getElementById('end-discussion-btn');
  const messageList = document.getElementById('message-list');
  const speechBtn = document.getElementById('speech-btn');
  const interruptBtn = document.getElementById('interrupt-btn');
  const hintBtn = document.getElementById('hint-btn');
  const nextSpeakerModal = document.getElementById('next-speaker-modal');
  const speakerOptions = document.getElementById('speaker-options');
  const interruptModal = document.getElementById('interrupt-modal');
  const interruptRequester = document.getElementById('interrupt-requester');
  const acceptInterruptBtn = document.getElementById('accept-interrupt-btn');
  const rejectInterruptBtn = document.getElementById('reject-interrupt-btn');
  const endConfirmModal = document.getElementById('end-confirm-modal');
  const confirmEndBtn = document.getElementById('confirm-end-btn');
  const cancelEndBtn = document.getElementById('cancel-end-btn');

  let ws = null;
  let discussionState = null;
  let myMemberId = null;
  let isOwner = false;
  let isSpeaking = false;
  let currentSpeakerActive = false;
  let botDrafts = new Map();

  // Audio state
  let whipCleanup = null;   // cleanup function for WHIP publish connection
  let whepCleanup = null;   // cleanup function for WHEP subscribe connection
  let remoteAudioElement = null; // <audio> element for remote playback

  function recoverToCurrentPhase(result, fallbackMessage) {
    if (!result?.data) {
      Storage.clearRoomData();
      UI.navigate('/setup');
      return;
    }

    const roomData = result.data;
    const uuid = Storage.getUuid();
    const myMember = (roomData.members || []).find((member) => member.kind === 'human' && member.userUuid === uuid);
    const resolvedIsOwner = roomData.ownerUuid === uuid || myMember?.isOwner;

    if (myMember?.memberId) {
      Storage.setMemberId(myMember.memberId);
    }
    Storage.setIsOwner(Boolean(resolvedIsOwner));
    Storage.setPhase(roomData.phase);

    if (roomData.phase === 'lobby') {
      UI.navigate(resolvedIsOwner ? '/create' : '/setup');
      return;
    }
    if (roomData.phase === 'summary') {
      UI.navigate('/summary');
      return;
    }

    Storage.clearRoomData();
    if (fallbackMessage) {
      UI.showMessage(fallbackMessage, 'error');
    }
    UI.navigate('/setup');
  }

  async function handleWsFailure(message) {
    if (ws) {
      ws.close();
      ws = null;
    }

    const uuid = Storage.getUuid();
    const roomId = Storage.getRoomId();
    if (!uuid || !roomId) {
      Storage.clearRoomData();
      UI.navigate('/setup');
      return;
    }

    const result = await Api.getRoomState(uuid, roomId);
    recoverToCurrentPhase(result, message);
  }

  async function init() {
    const uuid = Storage.getUuid();
    const roomId = Storage.getRoomId();
    myMemberId = Storage.getMemberId();
    isOwner = Storage.getIsOwner();

    if (!uuid || !roomId) {
      UI.navigate('/setup');
      return;
    }

    speechBtn.addEventListener('click', handleSpeechToggle);
    interruptBtn.addEventListener('click', handleInterruptRequest);
    hintBtn.addEventListener('click', handleAskHint);
    endDiscussionBtn.addEventListener('click', () => UI.setVisible(endConfirmModal, true));
    confirmEndBtn.addEventListener('click', handleEndDiscussion);
    cancelEndBtn.addEventListener('click', () => UI.setVisible(endConfirmModal, false));
    acceptInterruptBtn.addEventListener('click', () => handleInterruptResponse(true));
    rejectInterruptBtn.addEventListener('click', () => handleInterruptResponse(false));

    const canContinue = await checkRoomState(uuid, roomId);
    if (!canContinue) return;

    endDiscussionBtn.style.display = isOwner ? 'block' : 'none';
    connectWebSocket(uuid, roomId);
  }

  async function checkRoomState(uuid, roomId) {
    const result = await Api.getRoomState(uuid, roomId);
    if (!result.success || !result.data) {
      Storage.clearRoomData();
      UI.navigate('/setup');
      return false;
    }

    const roomData = result.data;
    const myMember = (roomData.members || []).find((member) => member.kind === 'human' && member.userUuid === uuid);
    const resolvedIsOwner = roomData.ownerUuid === uuid || myMember?.isOwner;

    if (roomData.phase === 'lobby') {
      if (myMember?.memberId) {
        Storage.setMemberId(myMember.memberId);
      }
      Storage.setIsOwner(Boolean(resolvedIsOwner));
      Storage.setPhase('lobby');
      UI.navigate(resolvedIsOwner ? '/create' : '/setup');
      return false;
    }

    if (roomData.phase === 'summary') {
      if (myMember?.memberId) {
        Storage.setMemberId(myMember.memberId);
      }
      Storage.setIsOwner(Boolean(resolvedIsOwner));
      Storage.setPhase('summary');
      UI.navigate('/summary');
      return false;
    }

    if (!myMember?.memberId) {
      Storage.clearRoomData();
      UI.navigate('/setup');
      return false;
    }

    myMemberId = myMember.memberId;
    isOwner = Boolean(resolvedIsOwner);
    Storage.setMemberId(myMember.memberId);
    Storage.setIsOwner(isOwner);
    Storage.setPhase('discuss');

    if (roomData.discussion) {
      renderMessages(roomData.discussion.messages || []);
      updateDiscussionState(roomData.discussion, roomData.members || []);
      isSpeaking = roomData.discussion.currentSpeakerMemberId === myMemberId && isSpeaking;
      updateButtonStates();
    }
    return true;
  }

  function connectWebSocket(uuid, roomId) {
    ws = new WebSocketClient();
    ws.on('error', (message) => {
      handleWsFailure(message.data?.msg || 'Discussion connection failed');
    });
    ws.on('discussion_state', (message) => {
      if (message.data?.messages) {
        renderMessages(message.data.messages);
      }
      updateDiscussionState(message.data, message.data?.members || []);
    });
    ws.on('speaker_started', (message) => {
      currentSpeakerActive = true;
      updateCurrentSpeaker(message.data.displayName, true);
      if (message.data.memberId === myMemberId) {
        isSpeaking = true;
      } else if (message.data.mediaPath) {
        // Subscribe to the speaker's audio via WHEP
        subscribeToSpeaker(message.data.mediaPath);
      }
      updateButtonStates();
    });
    ws.on('speaker_stopped', (message) => {
      currentSpeakerActive = false;
      if (message.data.memberId === myMemberId) isSpeaking = false;
      // Unsubscribe from audio when speaker stops
      unsubscribeFromSpeaker();
      updateButtonStates();
    });
    ws.on('message_created', (message) => {
      const chatMessage = message.data?.message;
      if (!chatMessage) return;
      if (chatMessage.speakerMemberId) {
        removeBotDraft(chatMessage.speakerMemberId);
      }
      addChatMessage(chatMessage);
    });
    ws.on('interrupt_requested', (message) => showInterruptModal(message.data?.fromDisplayName));
    ws.on('interrupt_resolved', () => UI.setVisible(interruptModal, false));
    ws.on('hint', (message) => message.data?.text && addSystemMessage(`AI Hint: ${message.data.text}`));
    ws.on('bot_stream', (message) => handleBotStream(message.data));
    ws.on('bot_done', (message) => handleBotDone(message.data));
    ws.on('discussion_ended', () => {
      // Clean up any active audio connections
      cleanupAllAudio();
      Storage.setPhase('summary');
      ws.close();
      UI.navigate('/summary');
    });
    ws.connect('/api/ws/discuss', { uuid, roomId }).catch((error) => {
      handleWsFailure(error?.message || 'Failed to connect to discussion');
    });
  }

  function updateDiscussionState(state, members) {
    discussionState = { ...state, members, messages: state?.messages || [] };
    currentSpeakerActive = Boolean(state?.currentSpeakerActive);
    roundBadge.textContent = `Round ${state.currentRound || 1}`;
    const currentSpeaker = members.find((member) => member.memberId === state.currentSpeakerMemberId) || null;
    updateCurrentSpeaker(currentSpeaker ? currentSpeaker.displayName : 'Unclaimed', Boolean(currentSpeaker));
    if (!currentSpeaker || currentSpeaker.memberId !== myMemberId) {
      isSpeaking = false;
    }
    updateButtonStates();
  }

  function updateCurrentSpeaker(name, active) {
    currentSpeakerName.textContent = name || 'Unclaimed';
    speakingIndicator.style.display = active ? 'inline-block' : 'none';
  }

  function updateButtonStates() {
    if (!discussionState) return;
    const currentSpeakerId = discussionState.currentSpeakerMemberId;
    const myMember = (discussionState.members || []).find((member) => member.memberId === myMemberId);
    const hasSpokenThisRound = (discussionState.roundSpokenMemberIds || []).includes(myMemberId);
    const amICurrentSpeaker = currentSpeakerId === myMemberId;
    const firstSpeakerClaimOpen = currentSpeakerId === null && myMember?.kind === 'human';
    const anotherSpeakerActive = Boolean(currentSpeakerId) && currentSpeakerId !== myMemberId && currentSpeakerActive;
    const amHuman = myMember?.kind === 'human';

    speechBtn.disabled = !(amICurrentSpeaker || firstSpeakerClaimOpen);
    speechBtn.textContent = isSpeaking ? 'End Speaking' : (firstSpeakerClaimOpen ? 'Claim First Turn' : 'Start Speaking');
    interruptBtn.disabled = !(anotherSpeakerActive && amHuman && !hasSpokenThisRound);
    hintBtn.disabled = !(amICurrentSpeaker && !currentSpeakerActive);
  }

  /**
   * Handle Start Speaking / End Speaking toggle.
   *
   * Start Speaking:
   *   1. Request microphone via getUserMedia
   *   2. Create WHIP connection to mediamtx
   *   3. Send start_speaking with real mediaPath
   *
   * End Speaking:
   *   1. Close WHIP connection and stop mic track
   *   2. Send stop_speaking (after showing next-speaker modal)
   */
  async function handleSpeechToggle() {
    if (!discussionState || !ws) return;
    if (!isSpeaking) {
      const canStart = discussionState.currentSpeakerMemberId === myMemberId || discussionState.currentSpeakerMemberId === null;
      if (!canStart) return;

      const roomId = Storage.getRoomId();
      const mediaPath = `room/${roomId}/${myMemberId}`;

      try {
        const whipResult = await Media.startWhip(roomId, myMemberId);
        whipCleanup = whipResult.cleanup;
        isSpeaking = true;
        ws.send({ type: 'start_speaking', data: { mediaPath } });
        updateButtonStates();
      } catch (err) {
        console.error('[discuss] WHIP connection failed:', err);
        addSystemMessage('Failed to start audio. Please check microphone permissions.');
        isSpeaking = false;
        updateButtonStates();
      }
      return;
    }
    // End speaking — show next-speaker modal
    showNextSpeakerModal();
  }

  /**
   * Clean up WHIP (publish) connection.
   */
  function cleanupWhip() {
    if (whipCleanup) {
      try { whipCleanup(); } catch (_) {}
      whipCleanup = null;
    }
  }

  /**
   * Clean up WHEP (subscribe) connection and audio element.
   */
  function cleanupWhep() {
    if (whepCleanup) {
      try { whepCleanup(); } catch (_) {}
      whepCleanup = null;
    }
    if (remoteAudioElement) {
      remoteAudioElement.pause();
      remoteAudioElement.srcObject = null;
      remoteAudioElement.remove();
      remoteAudioElement = null;
    }
  }

  /**
   * Clean up all active audio connections.
   */
  function cleanupAllAudio() {
    cleanupWhip();
    cleanupWhep();
  }

  /**
   * Subscribe to a speaker's audio via WHEP.
   * Ensures only one active playback at a time.
   *
   * @param {string} mediaPath - e.g. "room/{roomId}/{memberId}"
   */
  async function subscribeToSpeaker(mediaPath) {
    // Clean up any prior WHEP connection first
    cleanupWhep();

    // Parse roomId and memberId from mediaPath
    const parts = mediaPath.split('/');
    if (parts.length < 3) {
      console.warn('[discuss] Invalid mediaPath:', mediaPath);
      return;
    }
    const roomId = parts[1];
    const memberId = parts[2];

    // Create a hidden audio element
    remoteAudioElement = document.createElement('audio');
    remoteAudioElement.autoplay = true;
    remoteAudioElement.style.display = 'none';
    document.body.appendChild(remoteAudioElement);

    try {
      const whepResult = await Media.startWhep(roomId, memberId, remoteAudioElement);
      whepCleanup = whepResult.cleanup;
    } catch (err) {
      console.error('[discuss] WHEP connection failed:', err);
      cleanupWhep();
      addSystemMessage('Failed to connect to speaker audio.');
    }
  }

  /**
   * Unsubscribe from current speaker's audio.
   */
  function unsubscribeFromSpeaker() {
    cleanupWhep();
  }

  function showNextSpeakerModal() {
    if (!discussionState) return;
    const roundSpokenIds = discussionState.roundSpokenMemberIds || [];
    let availableMembers = (discussionState.members || []).filter((member) => member.memberId !== myMemberId && !roundSpokenIds.includes(member.memberId));
    if (availableMembers.length === 0) {
      availableMembers = (discussionState.members || []).filter((member) => member.memberId !== myMemberId);
    }
    speakerOptions.innerHTML = '';
    availableMembers.forEach(addSpeakerOption);
    UI.setVisible(nextSpeakerModal, true);
  }

  function addSpeakerOption(member) {
    const option = document.createElement('div');
    option.className = 'speaker-option';
    option.textContent = member.displayName + (member.isOwner ? ' (Owner)' : '');
    option.addEventListener('click', () => {
      // Close WHIP and stop mic before sending stop_speaking
      cleanupWhip();
      ws.send({ type: 'stop_speaking', data: { nextSpeakerMemberId: member.memberId } });
      UI.setVisible(nextSpeakerModal, false);
      isSpeaking = false;
      updateButtonStates();
    });
    speakerOptions.appendChild(option);
  }

  function handleInterruptRequest() {
    if (!discussionState?.currentSpeakerMemberId) return;
    ws.send({ type: 'interrupt_request', data: { targetSpeakerMemberId: discussionState.currentSpeakerMemberId } });
  }

  function showInterruptModal(fromDisplayName) {
    interruptRequester.textContent = fromDisplayName || 'Someone';
    UI.setVisible(interruptModal, true);
  }

  function handleInterruptResponse(accepted) {
    ws.send({ type: 'interrupt_response', data: { accepted } });
  }

  function handleAskHint() {
    ws.send({ type: 'ask_hint' });
  }

  async function handleEndDiscussion() {
    UI.setVisible(endConfirmModal, false);
    // Clean up audio before ending
    cleanupAllAudio();
    const result = await Api.endDiscussion(Storage.getUuid(), Storage.getRoomId());
    if (!result.success) {
      UI.showMessage(result.msg || 'Failed to end discussion', 'error');
      return;
    }
    Storage.setPhase('summary');
    ws.close();
    UI.navigate('/summary');
  }

  function renderMessages(messages) {
    messageList.innerHTML = '';
    botDrafts = new Map();
    messages.forEach(addChatMessage);
  }

  function addChatMessage(message) {
    const msgEl = UI.createChatMessage(message);
    messageList.appendChild(msgEl);
    scrollMessagesToBottom();
  }

  function handleBotStream(data) {
    if (!data?.memberId) return;
    const draft = ensureBotDraft(data.memberId);
    draft.text += data.chunk || '';
    draft.element.textContent = draft.text;
    scrollMessagesToBottom();
  }

  function handleBotDone(data) {
    if (!data?.memberId) return;
    const draft = ensureBotDraft(data.memberId);
    draft.text = data.fullText || draft.text;
    draft.element.textContent = draft.text;
    draft.wrapper.dataset.botDone = 'true';
    scrollMessagesToBottom();
  }

  function ensureBotDraft(memberId) {
    let draft = botDrafts.get(memberId);
    if (draft) {
      return draft;
    }

    const member = (discussionState?.members || []).find((item) => item.memberId === memberId);
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-message';
    const speaker = document.createElement('div');
    speaker.className = 'chat-speaker';
    speaker.textContent = member?.displayName || 'Bot';
    const text = document.createElement('div');
    text.className = 'chat-text';
    wrapper.appendChild(speaker);
    wrapper.appendChild(text);
    messageList.appendChild(wrapper);

    draft = { wrapper, element: text, text: '' };
    botDrafts.set(memberId, draft);
    scrollMessagesToBottom();
    return draft;
  }

  function removeBotDraft(memberId) {
    const draft = botDrafts.get(memberId);
    if (!draft) return;
    draft.wrapper.remove();
    botDrafts.delete(memberId);
  }

  function scrollMessagesToBottom() {
    const messageArea = document.getElementById('message-area');
    messageArea.scrollTop = messageArea.scrollHeight;
  }

  function addSystemMessage(text) {
    addChatMessage({ type: 'system', text, createdAt: Date.now(), speakerDisplayName: 'System' });
  }

  window.addEventListener('beforeunload', () => {
    cleanupAllAudio();
    if (ws) ws.close();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
