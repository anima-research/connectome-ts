import { Space, Element, Component, SpaceEvent, FrameEndEvent } from '../src/spaces';
import { VEILStateManager } from '../src/veil/veil-state';

/**
 * Simple test component that logs events
 */
class LoggerComponent extends Component {
  onMount() {
    console.log(`[${this.element.name}] Component mounted`);
  }
  
  handleEvent(event: SpaceEvent): void {
    console.log(`[${this.element.name}] Received event: ${event.topic}`);
    
    // If this is a frame:end event, log some details
    if (event.topic === 'frame:end') {
      const frameEnd = event as FrameEndEvent;
      console.log(`  Frame ${frameEnd.payload.frameId} completed`);
      console.log(`  Has operations: ${frameEnd.payload.hasOperations}`);
      console.log(`  Has activation: ${frameEnd.payload.hasActivation}`);
    }
  }
}

/**
 * Test adapter component that generates events
 */
class TestAdapterComponent extends Component {
  onMount() {
    // Subscribe to frame events
    this.element.subscribe('frame:*');
    
    // Generate a test event after mounting
    setTimeout(() => {
      console.log('\n--- Generating test event ---');
      this.element.emit({
        topic: 'test.message',
        payload: { content: 'Hello from test adapter!' },
        timestamp: Date.now()
      });
    }, 100);
  }
  
  handleEvent(event: SpaceEvent): void {
    if (event.topic === 'frame:start') {
      // Add a VEIL operation during frame processing
      const space = this.element.space as Space;
      const currentFrame = space.getCurrentFrame();
      
      if (currentFrame) {
        console.log(`[${this.element.name}] Adding facet to frame`);
        currentFrame.operations.push({
          type: 'addFacet',
          facet: {
            id: `test-facet-${Date.now()}`,
            type: 'event',
            displayName: 'test-event',
            content: 'Test event from adapter'
          }
        });
      }
    }
  }
}

/**
 * Simple test of the Space/Element system
 */
async function testSpaceElement() {
  console.log('=== Testing Space/Element System ===\n');
  
  // Create VEIL state manager
  const veilState = new VEILStateManager();
  
  // Create root space
  const space = new Space(veilState);
  console.log('Created root space');
  
  // Add logger component to space
  const spaceLogger = new LoggerComponent();
  space.addComponent(spaceLogger);
  space.subscribe('*'); // Subscribe to all events
  
  // Create child elements
  const testAdapter = new Element('test-adapter');
  const messageHandler = new Element('message-handler');
  
  // Build element tree
  space.addChild(testAdapter);
  testAdapter.addChild(messageHandler);
  
  console.log('\nElement tree:');
  console.log('- root');
  console.log('  - test-adapter');
  console.log('    - message-handler');
  
  // Add components
  testAdapter.addComponent(new TestAdapterComponent());
  messageHandler.addComponent(new LoggerComponent());
  
  // Subscribe to events
  messageHandler.subscribe('test.*');
  
  // Wait for events to process
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Check VEIL state
  console.log('\n--- VEIL State ---');
  const state = veilState.getState();
  console.log(`Total frames: ${state.frameHistory.length}`);
  console.log(`Active facets: ${state.facets.size}`);
  
  // Test element references
  console.log('\n--- Element References ---');
  const adapterRef = testAdapter.getRef();
  console.log('Adapter ref:', JSON.stringify(adapterRef, null, 2));
  
  // Test finding elements
  const found = space.findInChildren('message-handler');
  console.log(`\nFound message-handler: ${found?.name}`);
  
  console.log('\n=== Test Complete ===');
}

// Run the test
testSpaceElement().catch(console.error);
