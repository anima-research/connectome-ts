#!/usr/bin/env node

import { 
  Space, 
  AxonElement,
  VEILStateManager,
  BasicAgent,
  MockLLMProvider,
  ConsoleChatComponent,
  Component
} from '../src';

async function main() {
  console.log('=== AXON Protocol Test ===');
  console.log('Testing dynamic component loading via AXON\n');
  
  // Create core systems
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Create mock LLM provider
  const llmProvider = new MockLLMProvider();
  
  // Set up mock responses
  llmProvider.setResponses([
    "Interesting! I can see the AXON component has loaded. Let me test the ping functionality.\n\n@test.ping()",
    "Great! I received a pong response. The component is working correctly. I can see it's also sending periodic heartbeats.",
    "The counter continues to increment, showing the component maintains state properly. The AXON protocol is working well!"
  ]);
  
  // Create agent
  const agent = new BasicAgent(
    {
      systemPrompt: `You are testing the AXON protocol - a system for dynamically loading components.
    
Available actions:
- @test.ping() - Send a ping to the test component

Observe how the component loads and maintains state. The component will send pong responses and periodic heartbeat updates.`
    },
    llmProvider,
    veilState
  );
  
  // Add console chat
  const consoleChat = new ConsoleChatComponent();
  space.addComponent(consoleChat);
  
  // Create AXON element
  const axonElement = new AxonElement({ id: 'test' });
  space.addChild(axonElement);
  
  // Add action handler component that converts element:action to test.ping
  class ActionHandler extends Component {
    onMount() {
      this.element.subscribe('element:action');
    }
    
    async handleEvent(event: any): Promise<void> {
      if (event.topic === 'element:action') {
        const payload = event.payload as any;
        const elementPath = payload.path?.slice(0, -1) || [];
        const action = payload.path?.[payload.path.length - 1];
        
        // Check if this is test.ping action
        if (elementPath.length === 1 && elementPath[0] === 'test' && action === 'ping') {
          console.log('[ActionHandler] Converting element:action to test.ping');
          // Find the test element and emit the event there
          const testElement = this.element.findChild('test');
          if (testElement) {
            testElement.emit({
              topic: 'test.ping',
              source: testElement.getRef(),
              payload: {},
              timestamp: Date.now()
            });
          }
        }
      }
    }
  }
  space.addComponent(new ActionHandler());
  
  // Add test ping tool
  agent.registerTool({
    name: 'test.ping',
    description: 'Send a ping to the test component',
    parameters: {},
    elementPath: ['test'],
    emitEvent: {
      topic: 'element:action',
      payloadTemplate: {}
    }
  });
  
  // Component to listen for test events
  class TestListener extends Component {
    onMount() {
      this.element.subscribe('test.pong');
    }
    
    async handleEvent(event: any): Promise<void> {
      if (event.topic === 'test.pong') {
        console.log('[Test] Received pong event:', event.payload);
      }
    }
  }
  space.addComponent(new TestListener());
  
  // Component to handle agent activation
  class ActivationHandler extends Component {
    onMount() {
      this.element.subscribe('agent:activate');
    }
    
    async handleEvent(event: any): Promise<void> {
      if (event.topic === 'agent:activate') {
        const frame = space.getCurrentFrame();
        if (frame) {
          frame.operations.push({
            type: 'agentActivation',
            source: 'test:console',
            reason: 'test-interaction'
          });
          
          // Set active stream
          frame.activeStream = {
            streamId: 'console:main',
            streamType: 'console',
            metadata: {
              channel: 'console'
            }
          };
        }
      }
    }
  }
  space.addComponent(new ActivationHandler());
  
  // Set agent
  space.setAgent(agent);
  (agent as any).setSpace(space, space.id);
  
  // Connect to AXON service
  console.log('[Test] Connecting to AXON service...');
  try {
    await axonElement.connect('axon://localhost:8080/axon-test');
    console.log('[Test] Successfully connected!');
  } catch (error) {
    console.error('[Test] Failed to connect:', error);
    console.log('\nMake sure the AXON test server is running:');
    console.log('  cd examples/axon-test && npx ts-node server.ts\n');
    process.exit(1);
  }
  
  // Trigger agent activation
  space.emit({
    topic: 'agent:activate',
    source: space.getRef(),
    payload: {},
    timestamp: Date.now()
  });
  
  // Set up graceful shutdown
  let shutdownTimer: NodeJS.Timeout;
  const shutdown = async () => {
    console.log('\n[Test] Shutting down...');
    if (shutdownTimer) clearTimeout(shutdownTimer);
    space.removeChild(axonElement);
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  // Auto-shutdown after 30 seconds for testing
  shutdownTimer = setTimeout(() => {
    console.log('\n[Test] Test completed, shutting down...');
    shutdown();
  }, 30000);
}

// Run the test
main().catch(console.error);