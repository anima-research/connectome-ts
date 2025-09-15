// This will be compiled to JS and served by the AXON server
// The require path will be shimmed by AxonElement
const { VEILComponent } = require('../../src/components/base-components');

/**
 * Simple test component for AXON loading
 */
class TestComponent extends VEILComponent {
  private intervalId?: NodeJS.Timeout;
  private counter = 0;
  
  onMount() {
    console.log('[TestComponent] Mounting...');
    
    // Listen for test events
    this.subscribe('test.ping');
  }
  
  async onFirstFrame(): Promise<void> {
    // Add initial state when first frame is processed
    this.addFacet({
      id: 'test-state',
      type: 'state',
      displayName: 'test',
      content: 'Test component loaded successfully!',
      attributes: {
        mounted: true,
        timestamp: new Date().toISOString()
      }
    });
    
    // Set up periodic updates using events
    this.subscribe('test.update');
    this.intervalId = setInterval(() => {
      // Emit an event that we'll handle in frame context
      this.emit({
        topic: 'test.update',
        payload: {}
      });
    }, 5000);
  }
  
  async handleEvent(event) {
    await super.handleEvent(event);
    
    if (event.topic === 'test.ping') {
      console.log('[TestComponent] Received ping!');
      this.emit({
        topic: 'test.pong',
        payload: { message: 'Pong from AXON component!' }
      });
    } else if (event.topic === 'test.update') {
      // Handle periodic updates in frame context
      this.counter++;
      this.updateState('test-state', {
        attributes: {
          counter: this.counter,
          lastUpdate: new Date().toISOString()
        }
      });
      this.emit({
        topic: 'test.pong',
        payload: { count: this.counter }
      });
    }
  }
  
  onUnmount() {
    console.log('[TestComponent] Unmounting...');
    
    // Clear interval
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    
    // Add farewell event
    this.addOperation({
      type: 'addFacet',
      facet: {
        id: `test-farewell-${Date.now()}`,
        type: 'event',
        content: 'Test component unmounted gracefully'
      }
    });
  }
}

// CommonJS export for AXON loading
module.exports.default = TestComponent;
