/**
 * WebSocket wrapper for phase-specific connections
 * Handles: setup, discuss, summary websockets
 */

const WS_BASE = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

class WebSocketClient {
  constructor() {
    this.ws = null;
    this.endpoint = null;
    this.messageHandlers = new Map();
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.pingInterval = null;
  }

  /**
   * Connect to a websocket endpoint
   * @param {string} endpoint - WebSocket endpoint path (e.g., '/api/ws/setup')
   * @param {Object} queryParams - Query parameters for handshake (e.g., { uuid, roomId })
   * @returns {Promise<void>}
   */
  connect(endpoint, queryParams = {}) {
    return new Promise((resolve, reject) => {
      this.close();

      this.endpoint = endpoint;
      let settled = false;
      let backendError = null;

      const queryString = Object.entries(queryParams)
        .filter(([_, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');

      const url = `${WS_BASE}${endpoint}${queryString ? '?' + queryString : ''}`;

      console.log(`Connecting to WebSocket: ${endpoint}`);

      const rejectOnce = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error || 'WebSocket connection failed')));
      };

      const resolveOnce = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          console.log(`WebSocket connected: ${endpoint}`);
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.startPing();

          if (queryParams.uuid && queryParams.roomId) {
            this.send({
              type: 'hello',
              uuid: queryParams.uuid,
              roomId: queryParams.roomId
            });
          }

          resolveOnce();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message?.type === 'error') {
              backendError = new Error(message.data?.msg || 'WebSocket backend rejected connection');
              if (!settled) {
                rejectOnce(backendError);
              }
            }
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        this.ws.onclose = (event) => {
          console.log(`WebSocket closed: ${endpoint}`);
          this.isConnected = false;
          this.stopPing();
          this.ws = null;

          if (!settled) {
            const closeError = backendError || new Error(event.reason || 'WebSocket closed before connection became usable');
            rejectOnce(closeError);
          }
        };

        this.ws.onerror = (error) => {
          console.error(`WebSocket error: ${endpoint}`, error);
          if (!settled) {
            rejectOnce(backendError || error || new Error('WebSocket error'));
          }
        };
      } catch (error) {
        rejectOnce(error);
      }
    });
  }

  /**
   * Close the websocket connection
   */
  close() {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  /**
   * Send a message through the websocket
   * @param {Object} message
   */
  send(message) {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected, cannot send message:', message);
    }
  }

  /**
   * Register a message handler
   * @param {string} type - Message type
   * @param {Function} handler - Handler function
   */
  on(type, handler) {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type).push(handler);
  }

  /**
   * Remove a message handler
   * @param {string} type - Message type
   * @param {Function} handler - Handler function to remove
   */
  off(type, handler) {
    if (this.messageHandlers.has(type)) {
      const handlers = this.messageHandlers.get(type);
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Handle incoming messages
   * @param {Object} message
   */
  handleMessage(message) {
    const { type } = message;
    
    // Handle ping/pong
    if (type === 'pong') {
      return;
    }

    // Call registered handlers
    if (this.messageHandlers.has(type)) {
      this.messageHandlers.get(type).forEach(handler => {
        try {
          handler(message);
        } catch (error) {
          console.error(`Error in message handler for ${type}:`, error);
        }
      });
    }

    // Call wildcard handlers
    if (this.messageHandlers.has('*')) {
      this.messageHandlers.get('*').forEach(handler => {
        try {
          handler(message);
        } catch (error) {
          console.error('Error in wildcard message handler:', error);
        }
      });
    }
  }

  /**
   * Start ping interval for heartbeat
   */
  startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.isConnected) {
        this.send({
          type: 'ping',
          ts: Date.now()
        });
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Stop ping interval
   */
  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Check if websocket is connected
   * @returns {boolean}
   */
  connected() {
    return this.isConnected;
  }
}

// Create singleton instance
const wsClient = new WebSocketClient();

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebSocketClient, wsClient };
}
