/**
 * Test AgentComponent in receptor/effector architecture
 * This demonstrates how existing components work with the new system
 */

import * as readline from 'readline';
import { config } from 'dotenv';
config();

import { 
  Space,
  VEILStateManager,
  Element,
  BasicAgent,
  AgentComponent,
  AnthropicProvider,
  MockLLMProvider
} from '../src';
import { 
  ConsoleInputReceptor, 
  ConsoleOutputEffector
} from '../src/components/console-receptors';

async function main() {
  console.log('=== Testing AgentComponent with Receptor/Effector ===\n');
  
  // Create VEIL state and Space
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Create agent
  const provider = process.env.USE_MOCK_LLM === 'true' 
    ? new MockLLMProvider()
    : new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY!
      });
      
  if (provider instanceof MockLLMProvider) {
    console.log('Using mock LLM provider\n');
    provider.addResponse('hello', 'Hello! How are you today?');
    provider.addResponse('hi', 'Hi there! Nice to meet you!');
    provider.addResponse('test', 'This is a test response from the mock provider.');
  }
  
  const agent = new BasicAgent({
    config: {
      name: 'Assistant',
      systemPrompt: 'You are a helpful assistant. Keep responses brief and friendly.'
    },
    provider: provider,
    veilStateManager: veilState
  });
  
  // Create agent element and component
  const agentElement = new Element('agent', space.id);
  const agentComponent = new AgentComponent(agent);
  
  // Add debugging to see what's happening
  const originalHandleEvent = agentComponent.handleEvent.bind(agentComponent);
  agentComponent.handleEvent = async (event) => {
    console.log(`[AgentComponent] Received event: ${event.topic}`);
    if (event.topic === 'frame:end') {
      const payload = event.payload as any;
      console.log(`[AgentComponent] Frame end:`, {
        hasOperations: payload.hasOperations,
        hasActivation: payload.hasActivation
      });
    }
    return originalHandleEvent(event);
  };
  
  agentElement.addComponent(agentComponent);
  space.addChild(agentElement);
  
  console.log('Agent element created and added to space\n');
  
  // Register receptors and effectors
  space.addReceptor(new ConsoleInputReceptor());
  space.addEffector(new ConsoleOutputEffector((content) => {
    console.log(`\n[Assistant]: ${content}`);
  }));
  
  console.log('Receptors and effectors registered\n');
  
  // Simulate console input
  console.log('Simulating console input event...\n');
  
  space.emit({
    topic: 'console:input',
    source: { elementId: 'console', elementPath: [] },
    timestamp: Date.now(),
    payload: {
      input: 'hello',
      timestamp: Date.now()
    }
  });
  
  // Give it time to process
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Check if there are any speech facets in VEIL state
  const state = veilState.getState();
  const speechFacets = Array.from(state.facets.values()).filter(f => f.type === 'speech');
  console.log(`\nSpeech facets in VEIL state: ${speechFacets.length}`);
  speechFacets.forEach(f => {
    console.log(`  - ${f.id}: "${f.content}" attributes:`, f.attributes);
  });
  
  // Wait a bit more to see if effector runs
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // Force another frame to trigger effectors?
  console.log('\nTriggering another frame...');
  space.emit({
    topic: 'test:dummy',
    source: { elementId: 'test', elementPath: [] },
    timestamp: Date.now(),
    payload: {}
  });
  
  await new Promise(resolve => setTimeout(resolve, 700));
  
  console.log('\n=== Test complete ===');
  process.exit(0);
}

main().catch(console.error);
