/**
 * WebRTC Media Helpers
 *
 * Provides WHIP (publish) and WHEP (subscribe) helpers for
 * real-time audio streaming via mediamtx.
 *
 * Dependencies: none (vanilla browser APIs)
 */

let _mediamtxBaseUrl = null;

/**
 * Resolve the mediamtx base URL.
 *
 * Strategy:
 * 1. Use cached value if already fetched.
 * 2. Use window.__MEDIAMTX_BASEURL if set by the backend (injected in HTML).
 * 3. Fetch from /api/config endpoint.
 * 4. Fall back to same host with port 8888.
 */
async function resolveMediamtxBaseUrl() {
  if (_mediamtxBaseUrl) return _mediamtxBaseUrl;

  if (typeof window !== 'undefined' && window.__MEDIAMTX_BASEURL) {
    _mediamtxBaseUrl = window.__MEDIAMTX_BASEURL.replace(/\/+$/, '');
    return _mediamtxBaseUrl;
  }

  try {
    const resp = await fetch('/api/config');
    if (resp.ok) {
      const json = await resp.json();
      if (json.data?.mediamtxBaseUrl) {
        // Backend URL is for Docker internal networking; browser needs the host URL.
        // Extract the host-accessible URL: use page hostname with mediamtx port.
        const loc = window.location;
        _mediamtxBaseUrl = `${loc.protocol}//${loc.hostname}:8888`;
        return _mediamtxBaseUrl;
      }
    }
  } catch (_) {
    // Fallback below
  }

  const loc = window.location;
  _mediamtxBaseUrl = `${loc.protocol}//${loc.hostname}:8888`;
  return _mediamtxBaseUrl;
}

/**
 * Get the mediamtx base URL synchronously (for URL building after resolution).
 */
function getMediamtxBaseUrl() {
  if (_mediamtxBaseUrl) return _mediamtxBaseUrl;
  const loc = window.location;
  return `${loc.protocol}//${loc.hostname}:8888`;
}

/**
 * Build WHIP endpoint URL for a given room/member.
 * @param {string} roomId
 * @param {string} memberId
 * @returns {string}
 */
function buildWhipUrl(roomId, memberId) {
  return `${getMediamtxBaseUrl()}/room/${roomId}/${memberId}/whip`;
}

/**
 * Build WHEP endpoint URL for a given room/member.
 * @param {string} roomId
 * @param {string} memberId
 * @returns {string}
 */
function buildWhepUrl(roomId, memberId) {
  return `${getMediamtxBaseUrl()}/room/${roomId}/${memberId}/whep`;
}

/**
 * Create a WHIP publishing connection.
 *
 * Requests microphone, creates RTCPeerConnection, negotiates with mediamtx,
 * and returns a cleanup function.
 *
 * @param {string} roomId
 * @param {string} memberId
 * @returns {Promise<{ peerConnection: RTCPeerConnection, localStream: MediaStream, cleanup: Function }>}
 */
async function startWhip(roomId, memberId) {
  await resolveMediamtxBaseUrl();

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

  function cleanup() {
    cleanupWhip(pc, localStream);
  }

  return { peerConnection: pc, localStream, cleanup };
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
  await resolveMediamtxBaseUrl();

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
  getMediamtxBaseUrl,
  resolveMediamtxBaseUrl,
  buildWhipUrl,
  buildWhepUrl,
  startWhip,
  startWhep,
};
