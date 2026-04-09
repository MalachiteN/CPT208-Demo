/**
 * API wrapper for uniform POST calls
 * All endpoints return { success, msg, data }
 */

const API_BASE = '';

const Api = {
  /**
   * Make a POST request to the API
   * @param {string} endpoint - API endpoint path
   * @param {Object} data - Request body data
   * @returns {Promise<Object>} - { success, msg, data }
   */
  async post(endpoint, data = {}) {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });

      let result = null;
      try {
        result = await response.json();
      } catch (parseError) {
        result = null;
      }

      if (result && typeof result.success === 'boolean' && typeof result.msg === 'string') {
        return result;
      }

      if (!response.ok) {
        return {
          success: false,
          msg: `HTTP error! status: ${response.status}`,
          data: null
        };
      }

      return {
        success: false,
        msg: 'Invalid API response',
        data: null
      };
    } catch (error) {
      console.error(`API Error (${endpoint}):`, error);
      return {
        success: false,
        msg: error.message || 'Network error',
        data: null
      };
    }
  },

  // Setup API
  
  /**
   * Create a new anonymous UUID
   * @returns {Promise<Object>}
   */
  setup() {
    return this.post('/api/setup', {});
  },

  /**
   * Create a new room
   * @param {string} uuid
   * @returns {Promise<Object>}
   */
  createRoom(uuid) {
    return this.post('/api/create', { uuid });
  },

  /**
   * Join an existing room
   * @param {string} uuid
   * @param {string} roomId
   * @returns {Promise<Object>}
   */
  joinRoom(uuid, roomId) {
    return this.post('/api/adduser', { uuid, roomId });
  },

  /**
   * Add a bot to the room
   * @param {string} uuid
   * @param {string} roomId
   * @param {string} botName
   * @param {string} persona
   * @returns {Promise<Object>}
   */
  addBot(uuid, roomId, botName, persona) {
    return this.post('/api/addbot', { uuid, roomId, botName, persona });
  },

  /**
   * Remove a member from the room
   * @param {string} uuid
   * @param {string} roomId
   * @param {string} memberId
   * @returns {Promise<Object>}
   */
  removeMember(uuid, roomId, memberId) {
    return this.post('/api/remove', { uuid, roomId, memberId });
  },

  /**
   * Start the discussion
   * @param {string} uuid
   * @param {string} roomId
   * @returns {Promise<Object>}
   */
  startDiscussion(uuid, roomId) {
    return this.post('/api/start', { uuid, roomId });
  },

  /**
   * End the discussion
   * @param {string} uuid
   * @param {string} roomId
   * @returns {Promise<Object>}
   */
  endDiscussion(uuid, roomId) {
    return this.post('/api/end', { uuid, roomId });
  },

  /**
   * Get current room state
   * @param {string} uuid
   * @param {string} roomId
   * @returns {Promise<Object>}
   */
  getRoomState(uuid, roomId) {
    return this.post('/api/room/state', { uuid, roomId });
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Api;
}
