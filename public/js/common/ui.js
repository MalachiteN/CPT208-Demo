/**
 * UI utilities for common operations
 */

const UI = {
  /**
   * Show a message to the user
   * @param {string} message
   * @param {string} type - 'error', 'success', 'info'
   * @param {HTMLElement} container - Container element (optional)
   */
  showMessage(message, type = 'info', container = null) {
    const targetContainer = container || document.getElementById('message-container');
    if (!targetContainer) {
      console.warn('Message container not found');
      return;
    }

    const messageEl = document.createElement('div');
    messageEl.className = `message message-${type}`;
    messageEl.textContent = message;

    targetContainer.innerHTML = '';
    targetContainer.appendChild(messageEl);

    // Auto-hide after 5 seconds
    setTimeout(() => {
      messageEl.remove();
    }, 5000);
  },

  /**
   * Clear messages
   * @param {HTMLElement} container - Container element (optional)
   */
  clearMessages(container = null) {
    const targetContainer = container || document.getElementById('message-container');
    if (targetContainer) {
      targetContainer.innerHTML = '';
    }
  },

  /**
   * Set loading state on a button
   * @param {HTMLElement} button
   * @param {boolean} isLoading
   * @param {string} originalText
   */
  setButtonLoading(button, isLoading, originalText = null) {
    if (isLoading) {
      button.dataset.originalText = originalText || button.textContent;
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Loading...';
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || originalText || 'Submit';
    }
  },

  /**
   * Enable/disable an element
   * @param {HTMLElement} element
   * @param {boolean} enabled
   */
  setEnabled(element, enabled) {
    if (element) {
      element.disabled = !enabled;
    }
  },

  /**
   * Show/hide an element
   * @param {HTMLElement} element
   * @param {boolean} visible
   */
  setVisible(element, visible) {
    if (element) {
      element.classList.toggle('hidden', !visible);
    }
  },

  /**
   * Create a member list item HTML
   * @param {Object} member - Member object
   * @param {boolean} showRemove - Whether to show remove button
   * @param {Function} onRemove - Remove callback
   * @returns {HTMLElement}
   */
  createMemberListItem(member, showRemove = false, onRemove = null) {
    const li = document.createElement('li');
    li.className = 'list-item';
    li.dataset.memberId = member.memberId;

    const infoDiv = document.createElement('div');
    infoDiv.className = 'list-item-info';

    // Kind badge
    const kindBadge = document.createElement('span');
    kindBadge.className = `badge badge-${member.kind}`;
    kindBadge.textContent = member.kind === 'human' ? 'Human' : 'Bot';
    infoDiv.appendChild(kindBadge);

    // Display name
    const nameSpan = document.createElement('span');
    nameSpan.textContent = member.displayName;
    infoDiv.appendChild(nameSpan);

    // Owner badge if applicable
    if (member.isOwner) {
      const ownerBadge = document.createElement('span');
      ownerBadge.className = 'badge badge-owner';
      ownerBadge.textContent = 'Owner';
      infoDiv.appendChild(ownerBadge);
    }

    li.appendChild(infoDiv);

    // Remove button if applicable
    if (showRemove && onRemove) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'list-item-actions';
      
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-danger btn-small';
      removeBtn.textContent = 'Remove';
      removeBtn.onclick = () => onRemove(member.memberId);
      actionsDiv.appendChild(removeBtn);
      
      li.appendChild(actionsDiv);
    }

    return li;
  },

  /**
   * Format a timestamp
   * @param {number} timestamp
   * @returns {string}
   */
  formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },

  /**
   * Navigate to a page
   * @param {string} path
   */
  navigate(path) {
    window.location.href = path;
  },

  /**
   * Render Markdown text to sanitized HTML
   * @param {string} text - Markdown text
   * @returns {string} Sanitized HTML
   */
  renderMarkdown(text) {
    if (!text) return '';
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return escaped.replace(/\n/g, '<br>');
    }
    marked.setOptions({ breaks: true, gfm: true });
    const rawHtml = marked.parse(text);
    return DOMPurify.sanitize(rawHtml);
  },

  /**
   * Get URL path
   * @returns {string}
   */
  getPath() {
    return window.location.pathname;
  },

  /**
   * Create a message element for chat
   * @param {Object} message
   * @returns {HTMLElement}
   */
  createChatMessage(message) {
    const div = document.createElement('div');
    div.className = 'chat-message';
    if (message.type === 'system') {
      div.classList.add('system-message');
    }

    const header = document.createElement('div');
    header.className = 'message-header';

    if (message.type !== 'system') {
      const nameSpan = document.createElement('span');
      nameSpan.className = 'message-sender';
      nameSpan.textContent = message.speakerDisplayName || 'Unknown';
      header.appendChild(nameSpan);

      const timeSpan = document.createElement('span');
      timeSpan.className = 'message-time';
      timeSpan.textContent = this.formatTime(message.createdAt);
      header.appendChild(timeSpan);
    }

    const content = document.createElement('div');
    content.className = 'message-content';
    if (message.type === 'bot_final' || message.type === 'bot_stream') {
      content.innerHTML = this.renderMarkdown(message.text);
      content.classList.add('markdown-content');
    } else if (message.type === 'system' && message.text && message.text.startsWith('AI Hint:')) {
      const hintPrefix = 'AI Hint: ';
      const hintText = message.text.slice(hintPrefix.length);
      content.innerHTML = '<strong>AI Hint:</strong> ' + this.renderMarkdown(hintText);
      content.classList.add('markdown-content');
    } else {
      content.textContent = message.text;
    }

    if (message.meta?.interrupted) {
      const interruptedBadge = document.createElement('span');
      interruptedBadge.className = 'badge';
      interruptedBadge.style.background = '#e74c3c';
      interruptedBadge.style.color = 'white';
      interruptedBadge.style.marginLeft = '8px';
      interruptedBadge.textContent = 'Interrupted';
      content.appendChild(interruptedBadge);
    }

    div.appendChild(header);
    div.appendChild(content);

    return div;
  }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UI;
}
