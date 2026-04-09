(function() {
  const roomIdDisplay = document.getElementById('room-id-display');
  const memberList = document.getElementById('member-list');
  const startDiscussionBtn = document.getElementById('start-discussion-btn');
  const botNameInput = document.getElementById('bot-name-input');
  const botPersonaInput = document.getElementById('bot-persona-input');
  const addBotBtn = document.getElementById('add-bot-btn');

  let ws = null;

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
    if (!result.success || !result.data) {
      Storage.clearRoomData();
      UI.showMessage(message || result.msg || 'Room is no longer available', 'error');
      UI.navigate('/setup');
      return;
    }

    const roomData = result.data;
    const myMember = (roomData.members || []).find((member) => member.kind === 'human' && member.userUuid === uuid);
    const isOwner = roomData.ownerUuid === uuid || myMember?.isOwner;

    if (myMember?.memberId) {
      Storage.setMemberId(myMember.memberId);
    }
    Storage.setIsOwner(Boolean(isOwner));
    Storage.setPhase(roomData.phase);

    if (roomData.phase === 'lobby') {
      UI.navigate(isOwner ? '/create' : '/setup');
      return;
    }
    if (roomData.phase === 'discuss') {
      UI.navigate('/discuss');
      return;
    }
    if (roomData.phase === 'summary') {
      UI.navigate('/summary');
      return;
    }

    Storage.clearRoomData();
    UI.navigate('/setup');
  }

  async function init() {
    const uuid = Storage.getUuid();
    const roomId = Storage.getRoomId();

    if (!uuid || !roomId) {
      UI.navigate('/setup');
      return;
    }

    const canContinue = await checkRoomState(uuid, roomId);
    if (!canContinue) return;

    roomIdDisplay.textContent = roomId;
    startDiscussionBtn.addEventListener('click', handleStartDiscussion);
    addBotBtn.addEventListener('click', handleAddBot);
    connectWebSocket(uuid, roomId);
  }

  async function checkRoomState(uuid, roomId) {
    const result = await Api.getRoomState(uuid, roomId);
    if (!result.success || !result.data) {
      UI.showMessage(result.msg || 'Failed to get room state', 'error');
      Storage.clearRoomData();
      UI.navigate('/setup');
      return false;
    }

    const myMember = (result.data.members || []).find((member) => member.kind === 'human' && member.userUuid === uuid);
    const isOwner = result.data.ownerUuid === uuid || myMember?.isOwner;

    if (!myMember) {
      Storage.clearRoomData();
      UI.navigate('/setup');
      return false;
    }

    Storage.setMemberId(myMember.memberId);
    Storage.setIsOwner(Boolean(isOwner));
    Storage.setRoomId(roomId);

    if (!isOwner) {
      Storage.setPhase(result.data.phase);
      UI.navigate(result.data.phase === 'lobby' ? '/setup' : result.data.phase === 'summary' ? '/summary' : '/discuss');
      return false;
    }

    if (result.data.phase === 'discuss') {
      Storage.setPhase('discuss');
      UI.navigate('/discuss');
      return false;
    }
    if (result.data.phase === 'summary') {
      Storage.setPhase('summary');
      UI.navigate('/summary');
      return false;
    }

    Storage.setPhase('lobby');
    updateMemberList(result.data.members);
    return true;
  }

  function connectWebSocket(uuid, roomId) {
    ws = new WebSocketClient();
    ws.on('error', (message) => {
      handleWsFailure(message.data?.msg || 'Room connection failed');
    });
    ws.on('room_update', (message) => updateMemberList(message.data?.members || []));
    ws.on('discussion_started', () => {
      Storage.setPhase('discuss');
      ws.close();
      UI.navigate('/discuss');
    });
    ws.on('removed_from_room', () => {
      Storage.clearRoomData();
      ws.close();
      UI.navigate('/setup');
    });
    ws.on('room_closed', () => {
      Storage.clearRoomData();
      ws.close();
      UI.navigate('/setup');
    });
    ws.connect('/api/ws/setup', { uuid, roomId }).catch((error) => {
      handleWsFailure(error?.message || 'Failed to connect to room updates');
    });
  }

  function updateMemberList(members) {
    const myMemberId = Storage.getMemberId();
    memberList.innerHTML = '';
    members.forEach((member) => {
      const showRemove = member.memberId !== myMemberId && !member.isOwner;
      const li = UI.createMemberListItem(member, showRemove, showRemove ? () => handleRemoveMember(member.memberId) : null);
      if (member.kind === 'bot' && member.botProfile?.persona) {
        const personaDiv = document.createElement('div');
        personaDiv.className = 'bot-presence';
        personaDiv.textContent = member.botProfile.persona;
        li.querySelector('.list-item-info').appendChild(personaDiv);
      }
      memberList.appendChild(li);
    });
  }

  async function handleAddBot() {
    const uuid = Storage.getUuid();
    const roomId = Storage.getRoomId();
    const result = await Api.addBot(uuid, roomId, botNameInput.value.trim(), botPersonaInput.value.trim());
    if (!result.success) {
      UI.showMessage(result.msg || 'Failed to add bot', 'error');
      return;
    }
    botNameInput.value = '';
    botPersonaInput.value = '';
  }

  async function handleRemoveMember(memberId) {
    const result = await Api.removeMember(Storage.getUuid(), Storage.getRoomId(), memberId);
    if (!result.success) UI.showMessage(result.msg || 'Failed to remove member', 'error');
  }

  async function handleStartDiscussion() {
    const result = await Api.startDiscussion(Storage.getUuid(), Storage.getRoomId());
    if (!result.success) {
      UI.showMessage(result.msg || 'Failed to start discussion', 'error');
      return;
    }
    Storage.setPhase('discuss');
    ws.close();
    UI.navigate('/discuss');
  }

  window.addEventListener('beforeunload', () => ws && ws.close());

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();