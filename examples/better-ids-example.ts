/**
 * Example: How friendly IDs and stable ID support improve the developer experience
 */

import { Component, friendlyId, addFacet, removeFacet } from '../src';

/**
 * A component that manages UI panels
 * Shows how stable IDs make state management clean
 */
class PanelManager extends Component {
  private panels = new Map<string, any>();
  
  onFirstFrame() {
    // Persistent UI with readable ID
    this.addState('panel-status', 'No panels open', {
      panelCount: 0
    });
  }
  
  openPanel(panelType: string, content: string) {
    // Use semantic, stable IDs for panels
    const panelId = `panel-${panelType}`;
    
    // Check if already open
    if (this.panels.has(panelId)) {
      this.updatePanel(panelId, content);
      return;
    }
    
    // Add panel with stable ID for easy updates/removal
    this.addAmbient(
      content,
      panelId,  // Stable, semantic ID
      {
        panelType,
        openedAt: Date.now(),
        actions: ['close', 'minimize']
      }
    );
    
    this.panels.set(panelId, { type: panelType, content });
    this.updatePanelCount();
  }
  
  updatePanel(panelId: string, newContent: string) {
    // Easy updates with stable IDs
    this.addOperation(
      changeState(panelId, {
        content: newContent,
        attributes: { updatedAt: Date.now() }
      })
    );
  }
  
  closePanel(panelType: string) {
    const panelId = `panel-${panelType}`;
    
    // Clean removal with known ID
    this.addOperation(
      removeFacet(panelId, 'delete')
    );
    
    this.panels.delete(panelId);
    this.updatePanelCount();
  }
  
  private updatePanelCount() {
    this.updateState('panel-status', {
      content: `${this.panels.size} panel${this.panels.size !== 1 ? 's' : ''} open`,
      attributes: {
        panelCount: this.panels.size,
        openPanels: Array.from(this.panels.keys())
      }
    });
  }
}

/**
 * Example showing ID generation patterns
 */
class NotificationSystem extends Component {
  private notificationQueue: string[] = [];
  
  // Transient notifications - auto IDs are fine
  showToast(message: string, type: 'info' | 'warning' | 'error' = 'info') {
    this.addEvent(
      message,
      `toast-${type}`,
      { autoClose: true, duration: 3000 }
    );
    // Creates IDs like: "my-element-event-1699123456789"
    // Perfect for transient notifications
  }
  
  // Persistent notifications - need stable IDs
  showAlert(alertId: string, message: string, actions?: string[]) {
    this.addAmbient(
      message,
      `alert-${alertId}`, // Stable ID for updates/dismissal
      {
        type: 'alert',
        actions: actions || ['dismiss'],
        persistent: true
      }
    );
  }
  
  // Update existing alert
  updateAlert(alertId: string, newMessage: string) {
    this.updateState(`alert-${alertId}`, {
      content: newMessage,
      attributes: { updatedAt: Date.now() }
    });
  }
  
  // Dismiss alert
  dismissAlert(alertId: string) {
    this.addOperation(
      removeFacet(`alert-${alertId}`, 'delete')
    );
  }
}

/**
 * Before vs After Comparison
 */

// BEFORE: Unwieldy IDs everywhere
class OldWay extends Component {
  showNotification(message: string) {
    const id = `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    // id = "notification-1699123456789-x7k9m2p4q" 
    
    this.notifications.set(id, message); // Good luck finding this later!
    
    this.addOperation({
      type: 'addFacet',
      facet: {
        id, // "notification-1699123456789-x7k9m2p4q"
        type: 'ambient',
        content: message,
        attributes: {},
        scope: []
      }
    });
  }
}

// AFTER: Clean, intentional IDs
class NewWay extends Component {
  showNotification(message: string, id?: string) {
    // Auto-generated: "notification-1", "notification-2", etc.
    // Or stable: "welcome-notification", "error-notification"
    this.addAmbient(message, id, { type: 'notification' });
  }
}

/**
 * The improvements:
 * 
 * 1. IDs are human-readable in logs and debugging
 * 2. Stable IDs are trivial to implement
 * 3. Less code for the same functionality
 * 4. Semantic IDs improve code clarity
 * 5. Updates and removals are straightforward
 * 
 * Developers can focus on their component logic,
 * not on generating and tracking cryptic IDs!
 */
