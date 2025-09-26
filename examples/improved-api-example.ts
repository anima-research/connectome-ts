/**
 * Example showing the improved Connectome API after addressing developer feedback
 * Compare this to what was needed before!
 */

import { 
  Component,
  createSpaceEvent,
  createAgentActivation,
  addFacet,
  removeFacet,
  changeState
} from '../src';

// BEFORE: Components required tons of boilerplate
// AFTER: Clean, intuitive API with built-in helpers

class MyComponent extends Component {
  onFirstFrame() {
    // Before: Had to manually construct facet objects with all fields
    // After: Simple helper methods
    this.addAmbient('Component initialized');
    this.addState('status', 'ready', { startTime: Date.now() });
  }

  onSpaceEvent(event: SpaceEvent) {
    // Before: Had to check frame state, construct operations manually
    // After: Just use the helpers
    if (event.topic === 'user:action') {
      this.addEvent('User performed action', 'interaction', {
        action: event.payload.action
      });
      
      // Update state is now trivial
      this.updateState('status', { 
        content: 'processing',
        attributes: { lastAction: event.payload.action }
      });
    }
  }
  
  // Creating events is now straightforward
  notifyOthers(message: string) {
    // Before: Had to build ElementRef manually, know exact structure
    // After: Factory function handles it
    const event = createSpaceEvent('my-component:notification', this.element, {
      message
    });
    this.element.emit(event);
  }
  
  // Activating agents is clear
  wakeAgent(reason: string) {
    // Before: Had to know exact facet structure
    // After: Purpose-built factory with friendly IDs
    const activation = createAgentActivation(reason, {
      id: 'user-help-request', // Optional stable ID
      priority: 'high',
      source: this.elementId
    });
    // activation.id = "user-help-request" or "activation-1"
    
    this.addOperation(addFacet(
      activation.content,
      activation.type,
      activation.attributes
    ));
  }
  
  // Stable IDs make updates trivial
  showStatus(message: string) {
    // Always updates the same status - no ID tracking needed!
    this.addAmbient(message, 'status-display', {
      timestamp: Date.now()
    });
  }
  
  // Complex operations are composable
  performUpdate(facetId: string, newContent: string) {
    // The operation factories make intent clear
    this.addOperation(
      changeState(facetId, { content: newContent })
    );
  }
}

// Testing is now approachable (pending test harness)
// Instead of building entire Space/Element/VEIL infrastructure:
/*
const component = new MyComponent();
component.element = mockElement();  // Simple mock
component.onFirstFrame();
// Assert operations were added
*/

// The key improvements:
// 1. No more guessing object structures
// 2. Clear error messages when used incorrectly  
// 3. Helpers for common patterns built into base class
// 4. Factory functions guide correct usage
// 5. Type safety without the type maze
