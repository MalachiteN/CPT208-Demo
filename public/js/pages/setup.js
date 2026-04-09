(function() {
  const uuidDisplay = document.getElementById('uuid-display');
  const uuidHelpText = document.getElementById('uuid-help-text');
  const roomIdInput = document.getElementById('room-id-input');
  const joinBtn = document.getElementById('join-btn');
  const createBtn = document.getElementById('create-btn');
  const freshSetupSection = document.getElementById('fresh-setup-section');
  const joinedLobbySection = document.getElementById('joined-lobby-section');
  const joinedRoomId = document.getElementById('joined-room-id');
  const waitingStatus = document.getElementById('waiting-status');
  const joinedMemberList = document.getElementById('joined-member-list');

  let ws = null;

  async function recoverFromWsFailure(message) {
    closeSetupWebSocket();

    const uuid = Storage.getUuid();
    const roomId = Storage.getRoomId();
    const phase = Storage.getPhase();
    const isOwner = Storage.getIsOwner();

    if (!uuid || !roomId || phase !== 'lobby' || isOwner) {
      await enterFreshSetupMode(true);
      if (message) {
        UI.showMessage(message, 'error');
      }
      return;
    }

    const result = await Api.getRoomState(uuid, roomId);
    if (!result.success || !result.data) {
      Storage.clearRoomData();
      await enterFreshSetupMode(true);
      if (message) {
        UI.showMessage(message, 'error');
      }
      return;
    }

    const roomData = result.data;
    const myMember = (roomData.members || []).find((member) => member.kind === 'human' && member.userUuid === uuid);
    const resolvedIsOwner = roomData.ownerUuid === uuid || myMember?.isOwner;

    if (roomData.phase === 'lobby' && myMember && !resolvedIsOwner) {
      Storage.setRoomId(roomData.roomId);
      Storage.setMemberId(myMember.memberId);
      Storage.setPhase('lobby');
      Storage.setIsOwner(false);
      renderJoinedLobbyState(roomData);
      connectSetupWebSocket(uuid, roomData.roomId);
      return;
    }

    if (roomData.phase === 'discuss') {
      if (myMember?.memberId) {
        Storage.setMemberId(myMember.memberId);
      }
      Storage.setIsOwner(Boolean(resolvedIsOwner));
      Storage.setPhase('discuss');
      UI.navigate('/discuss');
      return;
    }

    if (roomData.phase === 'summary') {
      if (myMember?.memberId) {
        Storage.setMemberId(myMember.memberId);
      }
      Storage.setIsOwner(Boolean(resolvedIsOwner));
      Storage.setPhase('summary');
      UI.navigate('/summary');
      return;
    }

    Storage.clearRoomData();
    await enterFreshSetupMode(true);
    if (message) {
      UI.showMessage(message, 'error');
    }
  }

  async function init() {
    joinBtn.addEventListener('click', handleJoinRoom);
    createBtn.addEventListener('click', handleCreateRoom);
    roomIdInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleJoinRoom();
    });

    const existingUuid = Storage.getUuid();
    const existingRoomId = Storage.getRoomId();
    const existingPhase = Storage.getPhase();
    const isOwner = Storage.getIsOwner();

    if (existingUuid) {
      uuidDisplay.textContent = existingUuid;
    }

    if (existingUuid && existingRoomId && existingPhase === 'lobby' && !isOwner) {
      roomIdInput.value = existingRoomId;
      const preserved = await checkJoinedLobbyState(existingUuid, existingRoomId);
      if (preserved) {
        return;
      }
    }

    await enterFreshSetupMode(true);
  }

  async function enterFreshSetupMode(shouldMintUuid) {
    closeSetupWebSocket();
    setMode('fresh');
    joinedMemberList.innerHTML = '<li class="empty-list">Not joined to a room yet.</li>';
    joinedRoomId.textContent = '-';
    waitingStatus.textContent = 'Not currently waiting in a joined room';

    if (shouldMintUuid || !Storage.getUuid()) {
      await requestNewUuid();
      return;
    }

    Storage.clearRoomData();
    uuidDisplay.textContent = Storage.getUuid() || 'Loading...';
    uuidHelpText.textContent = 'This ID identifies you for this session only';
  }

  async function requestNewUuid() {
    const result = await Api.setup();
    if (!result.success || !result.data?.uuid) {
      uuidDisplay.textContent = 'Error';
      UI.showMessage(result.msg || 'Failed to get UUID', 'error');
      return;
    }
    Storage.clearRoomData();
    Storage.setUuid(result.data.uuid);
    uuidDisplay.textContent = result.data.uuid;
    uuidHelpText.textContent = 'This ID identifies you for this session only';
  }

  async function checkJoinedLobbyState(uuid, roomId) {
    const result = await Api.getRoomState(uuid, roomId);
    if (!result.success || !result.data) {
      Storage.clearRoomData();
      await enterFreshSetupMode(true);
      return false;
    }

    const roomData = result.data;
    const myMember = (roomData.members || []).find((member) => member.kind === 'human' && member.userUuid === uuid);
    const isOwner = roomData.ownerUuid === uuid || myMember?.isOwner;

    if (roomData.phase === 'discuss') {
      if (myMember?.memberId) {
        Storage.setMemberId(myMember.memberId);
      }
      Storage.setIsOwner(Boolean(isOwner));
      Storage.setPhase('discuss');
      UI.navigate('/discuss');
      return true;
    }

    if (roomData.phase === 'summary') {
      if (myMember?.memberId) {
        Storage.setMemberId(myMember.memberId);
      }
      Storage.setIsOwner(Boolean(isOwner));
      Storage.setPhase('summary');
      UI.navigate('/summary');
      return true;
    }

    if (roomData.phase !== 'lobby' || !myMember || isOwner) {
      Storage.clearRoomData();
      await enterFreshSetupMode(true);
      return false;
    }

    Storage.setRoomId(roomId);
    Storage.setMemberId(myMember.memberId);
    Storage.setPhase('lobby');
    Storage.setIsOwner(false);
    renderJoinedLobbyState(roomData);
    connectSetupWebSocket(uuid, roomId);
    return true;
  }

  function setMode(mode) {
    const inJoinedLobby = mode === 'joined-lobby';
    freshSetupSection.classList.toggle('hidden', inJoinedLobby);
    joinedLobbySection.classList.toggle('hidden', !inJoinedLobby);
    uuidHelpText.textContent = inJoinedLobby
      ? 'Your UUID is preserved while you are waiting in this joined room'
      : 'This ID identifies you for this session only';
  }

  function renderJoinedLobbyState(roomData) {
    setMode('joined-lobby');
    uuidDisplay.textContent = Storage.getUuid() || roomData.ownerUuid || 'Unknown';
    joinedRoomId.textContent = roomData.roomId || '-';
    waitingStatus.textContent = roomData.phase === 'lobby'
      ? 'Waiting for owner to start discussion'
      : `Room phase: ${roomData.phase}`;
    updateJoinedMemberList(roomData.members || []);
  }

  function updateJoinedMemberList(members) {
    joinedMemberList.innerHTML = '';
    if (!members.length) {
      joinedMemberList.innerHTML = '<li class="empty-list">No members in room.</li>';
      return;
    }

    members.forEach((member) => {
      const li = UI.createMemberListItem(member, false, null);
      if (member.kind === 'bot' && member.botProfile?.persona) {
        const personaDiv = document.createElement('div');
        personaDiv.className = 'bot-presence';
        personaDiv.textContent = member.botProfile.persona;
        li.querySelector('.list-item-info').appendChild(personaDiv);
      }
      joinedMemberList.appendChild(li);
    });
  }

  function connectSetupWebSocket(uuid, roomId) {
    closeSetupWebSocket();
    ws = new WebSocketClient();
    ws.on('error', (message) => {
      recoverFromWsFailure(message.data?.msg || 'Room connection failed');
    });
    ws.on('room_update', (message) => {
      const roomData = message.data || {};
      const members = roomData.members || [];
      const myUuid = Storage.getUuid();
      const myMember = members.find((member) => member.kind === 'human' && member.userUuid === myUuid);

      if (!myMember || myMember.isOwner) {
        Storage.clearRoomData();
        ws.close();
        UI.navigate('/setup');
        return;
      }

      Storage.setMemberId(myMember.memberId);
      Storage.setRoomId(roomData.roomId || roomId);
      Storage.setPhase('lobby');
      Storage.setIsOwner(false);
      renderJoinedLobbyState({
        roomId: roomData.roomId || roomId,
        phase: roomData.phase || 'lobby',
        members,
      });
    });
    ws.on('discussion_started', () => {
      Storage.setPhase('discuss');
      closeSetupWebSocket();
      UI.navigate('/discuss');
    });
    ws.on('removed_from_room', async () => {
      Storage.clearRoomData();
      await enterFreshSetupMode(true);
    });
    ws.on('room_closed', async () => {
      Storage.clearRoomData();
      await enterFreshSetupMode(true);
    });
    ws.connect('/api/ws/setup', { uuid, roomId }).catch((error) => {
      recoverFromWsFailure(error?.message || 'Failed to connect to room updates');
    });
  }

  function closeSetupWebSocket() {
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  async function handleJoinRoom() {
    const roomId = roomIdInput.value.trim();
    const uuid = Storage.getUuid();
    if (!roomId || !uuid) {
      UI.showMessage('Please enter a room ID', 'error');
      return;
    }

    UI.setButtonLoading(joinBtn, true);
    const result = await Api.joinRoom(uuid, roomId);
    UI.setButtonLoading(joinBtn, false);

    if (!result.success) {
      UI.showMessage(result.msg || 'Failed to join room', 'error');
      return;
    }

    Storage.setRoomId(result.data.roomId);
    Storage.setMemberId(result.data.member.memberId);
    Storage.setPhase(result.data.phase);
    Storage.setIsOwner(false);
    renderJoinedLobbyState({
      roomId: result.data.roomId,
      phase: result.data.phase,
      members: result.data.members || [],
    });
    connectSetupWebSocket(uuid, result.data.roomId);
  }

  async function handleCreateRoom() {
    const uuid = Storage.getUuid();
    if (!uuid) {
      UI.showMessage('No UUID available', 'error');
      return;
    }

    UI.setButtonLoading(createBtn, true);
    const result = await Api.createRoom(uuid);
    UI.setButtonLoading(createBtn, false);

    if (!result.success) {
      UI.showMessage(result.msg || 'Failed to create room', 'error');
      return;
    }

    Storage.setRoomId(result.data.roomId);
    Storage.setMemberId(result.data.members[0].memberId);
    Storage.setPhase(result.data.phase);
    Storage.setIsOwner(true);
    UI.navigate('/create');
  }

  window.addEventListener('beforeunload', () => closeSetupWebSocket(), { once: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();