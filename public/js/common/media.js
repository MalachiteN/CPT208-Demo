/**
 * WebRTC Media Helpers
 *
 * Provides WHIP (publish) and WHEP (subscribe) helpers for
 * real-time audio streaming via mediamtx.
 *
 * Uses same-origin proxy routes on the app server to avoid CORS issues.
 *
 * Dependencies: none (vanilla browser APIs)
 */

/**
 * Build WHIP endpoint URL via same-origin proxy.
 * @param {string} roomId
 * @param {string} memberId
 * @returns {string}
 */
function buildWhipUrl(roomId, memberId) {
  return `/api/whip/${roomId}/${memberId}`;
}

/**
 * Build WHEP endpoint URL via same-origin proxy.
 * @param {string} roomId
 * @param {string} memberId
 * @returns {string}
 */
function buildWhepUrl(roomId, memberId) {
  return `/api/whep/${roomId}/${memberId}`;
}

/**
 * Create a WHIP publishing connection.
 *
 * Requests microphone, creates RTCPeerConnection, negotiates with mediamtx,
 * and waits for the peer connection to be fully established (DTLS+RTP flowing)
 * before returning.
 *
 * @param {string} roomId
 * @param {string} memberId
 * @returns {Promise<{ peerConnection: RTCPeerConnection, localStream: MediaStream, cleanup: Function }>}
 */
async function startWhip(roomId, memberId) {
  const localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false,
  });

  const pc = new RTCPeerConnection({
    iceServers: [],
  });

  // Add audio tracks
  for (const track of localStream.getAudioTracks()) {
    pc.addTrack(track, localStream);
  }

  // Create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Wait for ICE gathering to complete (or timeout)
  await waitForIceGathering(pc);

  const whipUrl = buildWhipUrl(roomId, memberId);

  // POST offer to WHIP endpoint
  const response = await fetch(whipUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sdp',
    },
    body: pc.localDescription.sdp,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    cleanupWhip(pc, localStream);
    throw new Error(`WHIP negotiation failed: ${response.status} ${errorText}`);
  }

  const answerSdp = await response.text();
  await pc.setRemoteDescription(new RTCSessionDescription({
    type: 'answer',
    sdp: answerSdp,
  }));

  // CRITICAL: wait for the peer connection to be fully established
  // (DTLS connected, RTP flowing) before returning success
  await waitForPeerConnection(pc);

  function cleanup() {
    cleanupWhip(pc, localStream);
  }

  return { peerConnection: pc, localStream, cleanup };
}

/**
 * Wait for RTCPeerConnection to reach "connected" state.
 * This ensures DTLS is established and media can flow.
 * Times out after 10 seconds.
 */
function waitForPeerConnection(pc) {
  return new Promise((resolve, reject) => {
    if (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected') {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      pc.removeEventListener('connectionstatechange', onStateChange);
      pc.removeEventListener('iceconnectionstatechange', onIceChange);
      reject(new Error('WebRTC peer connection timeout'));
    }, 10000);

    function onStateChange() {
      if (pc.connectionState === 'connected') {
        clearTimeout(timeout);
        pc.removeEventListener('connectionstatechange', onStateChange);
        pc.removeEventListener('iceconnectionstatechange', onIceChange);
        resolve();
      }
    }

    function onIceChange() {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        clearTimeout(timeout);
        pc.removeEventListener('connectionstatechange', onStateChange);
        pc.removeEventListener('iceconnectionstatechange', onIceChange);
        resolve();
      }
    }

    pc.addEventListener('connectionstatechange', onStateChange);
    pc.addEventListener('iceconnectionstatechange', onIceChange);
  });
}

/**
 * Create a WHEP subscribing connection.
 *
 * Creates RTCPeerConnection, negotiates with mediamtx,
 * attaches the received stream to the provided audio element.
 *
 * @param {string} roomId
 * @param {string} memberId
 * @param {HTMLAudioElement} audioElement - The <audio> element to play the stream
 * @returns {Promise<{ peerConnection: RTCPeerConnection, cleanup: Function }>}
 */
async function startWhep(roomId, memberId, audioElement) {
  const pc = new RTCPeerConnection({
    iceServers: [],
  });

  // We need to receive audio
  pc.addTransceiver('audio', { direction: 'recvonly' });

  // Create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Wait for ICE gathering to complete (or timeout)
  await waitForIceGathering(pc);

  const whepUrl = buildWhepUrl(roomId, memberId);

  // POST offer to WHEP endpoint
  const response = await fetch(whepUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sdp',
    },
    body: pc.localDescription.sdp,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    cleanupWhep(pc);
    throw new Error(`WHEP negotiation failed: ${response.status} ${errorText}`);
  }

  const answerSdp = await response.text();
  await pc.setRemoteDescription(new RTCSessionDescription({
    type: 'answer',
    sdp: answerSdp,
  }));

  // Attach received stream to audio element
  pc.ontrack = (event) => {
    if (audioElement) {
      audioElement.srcObject = event.streams[0] || new MediaStream([event.track]);
      audioElement.play().catch(() => {
        // Autoplay may be blocked; user interaction will be needed
      });
    }
  };

  function cleanup() {
    cleanupWhep(pc);
    if (audioElement) {
      audioElement.srcObject = null;
    }
  }

  return { peerConnection: pc, cleanup };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Wait for ICE gathering to complete or timeout after 3 seconds.
 */
function waitForIceGathering(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', checkState);
      resolve();
    }, 3000);
    function checkState() {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        pc.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }
    }
    pc.addEventListener('icegatheringstatechange', checkState);
  });
}

/**
 * Clean up a WHIP connection and its local stream.
 */
function cleanupWhip(pc, localStream) {
  if (localStream) {
    for (const track of localStream.getTracks()) {
      track.stop();
    }
  }
  if (pc) {
    pc.close();
  }
}

/**
 * Clean up a WHEP connection.
 */
function cleanupWhep(pc) {
  if (pc) {
    pc.close();
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

window.Media = {
  buildWhipUrl,
  buildWhepUrl,
  startWhip,
  startWhep,
};
