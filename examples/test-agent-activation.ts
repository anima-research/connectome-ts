/**
 * Test agent activation with Debug UI button
 */

import { ConnectomeHost } from '../src/host';
import { BasicAgent } from '../src/agent/basic-agent';
import { AgentComponent } from '../src/agent/agent-component';
import { Element } from '../src/spaces/element';
import { VEILComponent } from '../src/components/base-components';
import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { ComponentRegistry } from '../src/persistence/component-registry';
import { ConnectomeApplication } from '../src/host/types';
import { ConsoleChatElement } from '../src/elements/console-chat';

// Create a simple component to observe activations
class ObserverComponent extends VEILComponent {
  onMount() {
    console.log('[Observer] Mounted');
    
    // Subscribe to all events to see what's happening
    this.subscribe('*');
  }
  
  async handleEvent(event: any) {
    console.log('[Observer] Event:', event.topic, event.payload);
  }
}

async function main() {
  console.log('Starting agent activation test...');
  
  // Create host
  const host = new ConnectomeHost({
    debug: {
      enabled: true,
      port: 3000
    },
    persistencePath: './test-persistence',
    enableTrace: false
  });
  
  // Create app
  const app: ConnectomeApplication = {
    async createSpace() {
      const veilState = new VEILStateManager();
      const space = new Space(veilState);
      return { space, veilState };
    },
    
    async initialize(space: Space, veilState: VEILStateManager) {
      // No initial elements, we'll add them after
    },
    
    getComponentRegistry() {
      return ComponentRegistry;
    }
  };
  
  // Start application
  const space = await host.start(app);
  
  // Create agent component
  const agentComponent = new AgentComponent(new BasicAgent({
    name: 'TestAgent',
    systemPrompt: 'You are a test agent. When activated, say hello and describe what happened.',
    model: 'claude-3-5-sonnet-20241022',
    temperature: 0.7
  }));
  
  // Create agent element
  const agentElement = new Element('main-agent', 'Main Agent');
  await agentElement.addComponentAsync(agentComponent);
  
  // Create observer element
  const observerElement = new Element('observer', 'Observer');
  const observer = new ObserverComponent();
  await observerElement.addComponentAsync(observer);
  
  // Create console chat for agent responses
  const consoleChat = new ConsoleChatElement();
  
  // Add elements to space
  space.addChild(agentElement);
  space.addChild(observerElement);
  space.addChild(consoleChat);
  
  console.log('\n✅ Application started!');
  console.log('📍 Debug UI: http://localhost:3000');
  console.log('🤖 Agent element created: main-agent');
  console.log('💬 Console chat ready to display responses');
  console.log('\n👉 Click the "Activate Agent" button in the Debug UI to test');
  console.log('   The agent should respond with a greeting\n');
  
  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await host.stop();
    process.exit(0);
  });
}

main().catch(console.error);
