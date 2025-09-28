/**
 * Example showing how naming consistency improves the developer experience
 */

import { Component, VEILStateManager, changeState } from '../src';

class ConsistentComponent extends Component {
  onFirstFrame() {
    // Everything uses "changeState" now - no confusion!
    
    // Component method
    this.changeState('status', { content: 'Ready' });
    
    // Factory function for operations
    this.addOperation(
      changeState('global-status', { content: 'System ready' })
    );
  }
  
  checkVeilState() {
    // Getting state is now consistent too
    const veil = this.getVeilState();
    
    // Both work, but getState is preferred
    const state1 = veil?.getState();      // Preferred ✓
    const state2 = veil?.getCurrentState(); // Deprecated but works
  }
}

/**
 * Before: Confusing Mix
 */
class OldConfusingWay {
  updateStatus() {
    // Which one do I use?
    this.updateState('status', { content: 'Active' });    // Component method
    this.addOperation({
      type: 'changeFacet',  // But VEIL calls it changeState!
      id: 'status',
      changes: { content: 'Active' }
    });
    
    // And is it getState or getCurrentState?
    const state = veil.getCurrentState(); // Guessing...
  }
}

/**
 * After: Clear and Consistent
 */
class NewConsistentWay extends Component {
  updateStatus() {
    // One name throughout!
    this.changeState('status', { content: 'Active' });
    
    // Operation matches method name
    this.addOperation(
      changeState('status', { content: 'Active' })
    );
    
    // No guessing needed
    const state = this.getVeilState()?.getState();
  }
}

/**
 * The Benefits:
 * 
 * 1. No more confusion about which method to use
 * 2. VEIL operations match component methods
 * 3. Consistent naming reduces cognitive load
 * 4. Deprecated aliases ensure backward compatibility
 * 
 * If you know the VEIL operation name, you know the method name!
 */
