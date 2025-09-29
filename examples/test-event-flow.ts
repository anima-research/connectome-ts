#!/usr/bin/env ts-node

/**
 * Event Flow Demonstration
 * 
 * This test shows exactly how events flow through Connectome,
 * helping build intuition about the system.
 */

import { 
  Space, 
  Element,
  Component,
  VEILStateManager,
  BasicAgent,
  MockLLMProvider,
  AgentComponent
} from '../src';

class EventLoggerComponent extends Component {
  private eventCount = 0;
  
  onMount() {
    console.log(`  [${this.element.name}] Component mounted`);
    // Subscribe to everything to see event flow
    this.element.subscribe('*');
  }
  
  async handleEvent(event: any) {
    this.eventCount++;
    const indent = '  '.repeat(event.eventPhase || 1);
    const phase = ['NONE', 'CAPTURE', 'TARGET', 'BUBBLE'][event.eventPhase || 0];
    
    console.log(`${indent}[${this.element.name}] ${phase}: ${event.topic} (#${this.eventCount})`);
    
    // Show the propagation path
    if (event.currentTarget) {
      console.log(`${indent}  Current: ${event.currentTarget.elementId}`);
    }
    if (event.target) {
      console.log(`${indent}  Target: ${event.target.elementId}`);
    }
  }
}

async function demonstrateEventFlow() {
  console.log('=== Connectome Event Flow Demonstration ===\n');
  
  // 1. Create the basic structure
  console.log('1. SETUP PHASE');
  console.log('Creating: VEILStateManager → Space → Elements → Components\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Create element tree
  const container = new Element('container');
  const child1 = new Element('child1');
  const child2 = new Element('child2'); 
  const grandchild = new Element('grandchild');
  
  // Add logging to everything
  space.addComponent(new EventLoggerComponent());
  container.addComponent(new EventLoggerComponent());
  child1.addComponent(new EventLoggerComponent());
  child2.addComponent(new EventLoggerComponent());
  grandchild.addComponent(new EventLoggerComponent());
  
  // Build tree
  space.addChild(container);
  container.addChild(child1);
  container.addChild(child2);
  child1.addChild(grandchild);
  
  console.log('Tree structure:');
  console.log('  Space (root)');
  console.log('    └── container');
  console.log('         ├── child1');
  console.log('         │    └── grandchild');  
  console.log('         └── child2\n');
  
  // 2. Show mount order
  console.log('2. MOUNT PHASE (components initialize):');
  console.log('  Components mount in tree order...\n');
  
  // 3. Process first frame
  console.log('3. FIRST FRAME (components set initial state):');
  await space.processFrame();
  console.log('');
  
  // 4. Demonstrate event propagation
  console.log('4. EVENT PROPAGATION DEMONSTRATION\n');
  
  console.log('Emitting event from grandchild with bubbling:');
  console.log('Expected: Capture (root→target) → At Target → Bubble (target→root)\n');
  
  space.emit({
    topic: 'test:bubble',
    source: grandchild.getRef(),
    payload: { message: 'Hello from grandchild' },
    timestamp: Date.now(),
    bubbles: true
  });
  
  await space.processFrame();
  console.log('');
  
  // 5. Non-bubbling event
  console.log('5. NON-BUBBLING EVENT\n');
  console.log('Emitting event from grandchild WITHOUT bubbling:');
  console.log('Expected: Capture → At Target (no bubble phase)\n');
  
  space.emit({
    topic: 'test:no-bubble',
    source: grandchild.getRef(),
    payload: { message: 'Private message' },
    timestamp: Date.now(),
    bubbles: false
  });
  
  await space.processFrame();
  console.log('');
  
  // 6. Broadcast event
  console.log('6. BROADCAST EVENT\n');
  console.log('Broadcast reaches all subscribers regardless of position:');
  console.log('Expected: All elements receive it\n');
  
  space.emit({
    topic: 'test:broadcast',
    source: child2.getRef(),
    payload: { message: 'Announcement to all' },
    timestamp: Date.now(),
    broadcast: true
  });
  
  await space.processFrame();
  console.log('');
  
  // 7. Show frame creates event boundaries
  console.log('7. FRAME BOUNDARIES\n');
  console.log('Multiple events in one frame are processed together:\n');
  
  // Emit multiple events without processing
  space.emit({
    topic: 'batch:1',
    source: child1.getRef(),
    payload: {},
    timestamp: Date.now()
  });
  
  space.emit({
    topic: 'batch:2', 
    source: child2.getRef(),
    payload: {},
    timestamp: Date.now()
  });
  
  space.emit({
    topic: 'batch:3',
    source: container.getRef(),
    payload: {},
    timestamp: Date.now()
  });
  
  console.log('Processing all 3 events in single frame:');
  await space.processFrame();
  console.log('');
  
  // 8. Show VEIL state accumulation
  console.log('8. VEIL STATE ACCUMULATION\n');
  const frames = veilState.getFrameHistory();
  console.log(`Total frames processed: ${frames.length}`);
  console.log(`Current sequence number: ${veilState.getState().currentSequence}`);
  console.log(`Active facets: ${veilState.getActiveFacets().size}\n`);
  
  // 9. Agent interaction
  console.log('9. AGENT INTERACTION\n');
  console.log('Adding agent to show activation flow:\n');
  
  const agent = new BasicAgent(
    {
      name: 'demo-agent',
      systemPrompt: 'You are a demo agent'
    },
    new MockLLMProvider(),
    veilState
  );
  
  const agentElement = new Element('agent');
  const agentComponent = new AgentComponent(agent);
  agentElement.addComponent(agentComponent);
  agentElement.addComponent(new EventLoggerComponent());
  space.addChild(agentElement);
  
  console.log('Triggering agent activation:');
  
  // Create incoming frame with activation
  const incomingFrame = {
    sequence: veilState.getNextSequence(),
    timestamp: Date.now(),
    deltas: [{
      type: 'agent-activation' as const,
      source: 'user',
      reason: 'Demo activation'
    }]
  };
  
  veilState.applyFrame(incomingFrame);
  space.processIncomingFrame(incomingFrame);
  
  console.log('\nAgent will now process and potentially respond...\n');
  
  // Process agent response
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('=== End of Demonstration ===');
}

// Run the demonstration
demonstrateEventFlow().catch(console.error);
