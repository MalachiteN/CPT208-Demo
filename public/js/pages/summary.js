(function() {
  const emojiEveryone = document.getElementById('emoji-everyone');
  const valueEveryone = document.getElementById('value-everyone');
  const emojiInterruption = document.getElementById('emoji-interruption');
  const valueInterruption = document.getElementById('value-interruption');
  const emojiLeader = document.getElementById('emoji-leader');
  const valueLeader = document.getElementById('value-leader');
  const leaderValue = document.getElementById('leader-value');
  const lastSpeakerValue = document.getElementById('last-speaker-value');
  const roundsValue = document.getElementById('rounds-value');
  const messagesValue = document.getElementById('messages-value');
  const summaryText = document.getElementById('summary-text');
  const resetBtn = document.getElementById('reset-btn');

  let ws = null;
  let summaryTextContent = '';
  let reasoningTextContent = '';

  function recoverToCurrentPhase(result, fallbackMessage) {
    if (!result?.data) {
      Storage.clearRoomData();
      if (fallbackMessage) {
        UI.showMessage(fallbackMessage, 'error');
      }
      UI.navigate('/setup');
      return;
    }

    const roomData = result.data;
    const uuid = Storage.getUuid();
    const myMember = (roomData.members || []).find((member) => member.kind === 'human' && member.userUuid === uuid);
    const isOwner = roomData.ownerUuid === uuid || myMember?.isOwner;

    if (myMember?.memberId) {
      Storage.setMemberId(myMember.memberId);
    }
    Storage.setIsOwner(Boolean(isOwner));
    Storage.setPhase(roomData.phase);

    if (roomData.phase === 'summary') {
      return;
    }
    if (roomData.phase === 'discuss') {
      UI.navigate('/discuss');
      return;
    }
    if (roomData.phase === 'lobby') {
      UI.navigate(isOwner ? '/create' : '/setup');
      return;
    }

    Storage.clearRoomData();
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
    if (!uuid || !roomId) {
      UI.navigate('/setup');
      return;
    }

    resetBtn.addEventListener('click', handleReset);
    const canContinue = await checkRoomState(uuid, roomId);
    if (!canContinue) return;
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
    const isOwner = roomData.ownerUuid === uuid || myMember?.isOwner;

    if (roomData.phase === 'lobby') {
      if (myMember?.memberId) {
        Storage.setMemberId(myMember.memberId);
      }
      Storage.setIsOwner(Boolean(isOwner));
      Storage.setPhase('lobby');
      UI.navigate(isOwner ? '/create' : '/setup');
      return false;
    }
    if (roomData.phase === 'discuss') {
      if (myMember?.memberId) {
        Storage.setMemberId(myMember.memberId);
      }
      Storage.setIsOwner(Boolean(isOwner));
      Storage.setPhase('discuss');
      UI.navigate('/discuss');
      return false;
    }
    if (!myMember?.memberId) {
      Storage.clearRoomData();
      UI.navigate('/setup');
      return false;
    }

    Storage.setMemberId(myMember.memberId);
    Storage.setIsOwner(Boolean(isOwner));
    Storage.setPhase('summary');

    if (roomData.summary) {
      updateFixedRubrics(roomData.summary.fixedRubrics);
      updateStats(roomData.discussion, roomData.members);
      summaryTextContent = roomData.summary.llmSummaryText || '';
      reasoningTextContent = roomData.summary.reasoningContent || '';
      summaryText.classList.add('markdown-content');
      const reasoningHtml = reasoningTextContent
        ? `<div class="reasoning-block">${UI.renderMarkdown(reasoningTextContent)}</div>`
        : '';
      summaryText.innerHTML = reasoningHtml + UI.renderMarkdown(summaryTextContent);
    }
    return true;
  }

  function connectWebSocket(uuid, roomId) {
    ws = new WebSocketClient();
    ws.on('error', (message) => {
      handleWsFailure(message.data?.msg || 'Summary connection failed');
    });
    ws.on('summary_fixed', (message) => message.data && updateFixedRubrics(message.data));
    ws.on('summary_stream', (message) => {
      if (message.data?.reasoningContent) {
        reasoningTextContent += message.data.reasoningContent;
      }
      if (message.data?.chunk) {
        summaryTextContent += message.data.chunk;
      }
      const reasoningHtml = reasoningTextContent
        ? `<div class="reasoning-block">${UI.renderMarkdown(reasoningTextContent)}</div>`
        : '';
      summaryText.innerHTML = reasoningHtml + UI.renderMarkdown(summaryTextContent);
    });
    ws.on('summary_done', (message) => {
      summaryTextContent = message.data?.fullText || summaryTextContent;
      if (message.data?.reasoningContent) {
        reasoningTextContent = message.data.reasoningContent;
      }
      const reasoningHtml = reasoningTextContent
        ? `<div class="reasoning-block">${UI.renderMarkdown(reasoningTextContent)}</div>`
        : '';
      summaryText.innerHTML = reasoningHtml + UI.renderMarkdown(summaryTextContent);
    });
    ws.on('room_closed', () => {
      if (ws) ws.close();
      Storage.clearRoomData();
      UI.navigate('/setup');
    });
    ws.connect('/api/ws/summary', { uuid, roomId }).catch((error) => {
      handleWsFailure(error?.message || 'Failed to connect to summary');
    });
  }

  function updateFixedRubrics(rubrics) {
    emojiEveryone.textContent = rubrics.everyoneSpoke === null ? '➖' : rubrics.everyoneSpoke ? '✅' : '❌';
    valueEveryone.textContent = rubrics.everyoneSpoke === null ? 'N/A' : rubrics.everyoneSpoke ? 'Yes' : 'No';
    emojiInterruption.textContent = rubrics.hasValidInterruption ? '✅' : '❌';
    valueInterruption.textContent = rubrics.hasValidInterruption ? 'Yes' : 'No';
    emojiLeader.textContent = rubrics.leaderSameAsLastSpeaker === null ? '➖' : rubrics.leaderSameAsLastSpeaker ? '✅' : '❌';
    valueLeader.textContent = rubrics.leaderSameAsLastSpeaker === null ? 'N/A' : rubrics.leaderSameAsLastSpeaker ? 'Same' : 'Different';
    leaderValue.textContent = rubrics.leaderMemberId || 'N/A';
  }

  function updateStats(discussion, members) {
    if (!discussion) return;
    roundsValue.textContent = `Round ${discussion.currentRound || 1}`;
    messagesValue.textContent = String((discussion.messages || []).length);
    const lastSpeaker = members?.find((m) => m.memberId === discussion.lastSpeakerMemberId);
    lastSpeakerValue.textContent = lastSpeaker?.displayName || discussion.lastSpeakerMemberId || 'N/A';
    const leader = members?.find((m) => m.memberId === discussion.leaderMemberId);
    if (leader) leaderValue.textContent = leader.displayName;
  }

  function handleReset() {
    Storage.clear();
    if (ws) ws.close();
    UI.navigate('/setup');
  }

  window.addEventListener('beforeunload', () => ws && ws.close());

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();