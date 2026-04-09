/**
 * Storage utilities for managing browser state
 * Stores: uuid, roomId, memberId, phase
 */

const STORAGE_KEYS = {
  UUID: 'xjtlu_discuss_uuid',
  ROOM_ID: 'xjtlu_discuss_roomId',
  MEMBER_ID: 'xjtlu_discuss_memberId',
  PHASE: 'xjtlu_discuss_phase',
  IS_OWNER: 'xjtlu_discuss_isOwner'
};

const Storage = {
  /**
   * Get stored UUID
   * @returns {string|null}
   */
  getUuid() {
    return localStorage.getItem(STORAGE_KEYS.UUID);
  },

  /**
   * Set UUID
   * @param {string} uuid
   */
  setUuid(uuid) {
    localStorage.setItem(STORAGE_KEYS.UUID, uuid);
  },

  /**
   * Get stored room ID
   * @returns {string|null}
   */
  getRoomId() {
    return localStorage.getItem(STORAGE_KEYS.ROOM_ID);
  },

  /**
   * Set room ID
   * @param {string} roomId
   */
  setRoomId(roomId) {
    localStorage.setItem(STORAGE_KEYS.ROOM_ID, roomId);
  },

  /**
   * Get stored member ID
   * @returns {string|null}
   */
  getMemberId() {
    return localStorage.getItem(STORAGE_KEYS.MEMBER_ID);
  },

  /**
   * Set member ID
   * @param {string} memberId
   */
  setMemberId(memberId) {
    localStorage.setItem(STORAGE_KEYS.MEMBER_ID, memberId);
  },

  /**
   * Get stored phase
   * @returns {string|null}
   */
  getPhase() {
    return localStorage.getItem(STORAGE_KEYS.PHASE);
  },

  /**
   * Set phase
   * @param {string} phase
   */
  setPhase(phase) {
    localStorage.setItem(STORAGE_KEYS.PHASE, phase);
  },

  /**
   * Get owner status
   * @returns {boolean}
   */
  getIsOwner() {
    return localStorage.getItem(STORAGE_KEYS.IS_OWNER) === 'true';
  },

  /**
   * Set owner status
   * @param {boolean} isOwner
   */
  setIsOwner(isOwner) {
    localStorage.setItem(STORAGE_KEYS.IS_OWNER, isOwner ? 'true' : 'false');
  },

  /**
   * Clear all stored data (used on reset)
   */
  clear() {
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
  },

  /**
   * Clear room-related data only (keep UUID for new setup)
   */
  clearRoomData() {
    localStorage.removeItem(STORAGE_KEYS.ROOM_ID);
    localStorage.removeItem(STORAGE_KEYS.MEMBER_ID);
    localStorage.removeItem(STORAGE_KEYS.PHASE);
    localStorage.removeItem(STORAGE_KEYS.IS_OWNER);
  },

  /**
   * Get all stored state
   * @returns {Object}
   */
  getAll() {
    return {
      uuid: this.getUuid(),
      roomId: this.getRoomId(),
      memberId: this.getMemberId(),
      phase: this.getPhase(),
      isOwner: this.getIsOwner()
    };
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Storage;
}
