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
  
  // Create AXON element with action handling
  class TestAxonElement extends AxonElement {
    constructor() {
      super({ id: 'test' });
    }
    
    async handleAction(action: string, parameters?: any): Promise<any> {
      if (action === 'ping') {
        this.emit({
          topic: 'test.ping',
          source: this.getRef(),
          payload: {},
          timestamp: Date.now()
        });
        return { content: 'Ping sent!' };
      }
    }
  }
  
  const axonElement = new TestAxonElement();
  space.addChild(axonElement);
  
  // Add test ping tool using smart defaults
  agent.registerTool('test.ping');
  
  // Component to listen for test events
  class TestListener extends Component {
    onMount() {
      this.subscribe('test.pong');  // Using convenience method
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
      this.subscribe('agent:activate');  // Using convenience method
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
  
  // Set agent (auto-wires the bidirectional connection)
  space.setAgent(agent);
  
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