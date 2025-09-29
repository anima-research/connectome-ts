import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { ConsoleInputReceptor } from '../src/components/console-receptors';
import { ConsoleOutputEffector } from '../src/components/console-receptors';
import { ContextTransform } from '../src/hud/context-transform';
import { 
  AgentEffector,
  MockLLMProvider,
  BasicAgent,
  AgentElement
} from '../src';

async function main() {
  console.log('=== Frame Events Debug Test ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Add components
  space.addReceptor(new ConsoleInputReceptor());
  space.addTransform(new ContextTransform(veilState));
  space.addEffector(new ConsoleOutputEffector());
  
  // Create agent
  const agentElement = new AgentElement('test-agent');
  space.addChild(agentElement);
  
  const mockProvider = new MockLLMProvider();
  mockProvider.setResponses(["Hello from the agent!"]);
  
  const agent = new BasicAgent({
    config: {
      name: 'TestAgent',
      systemPrompt: 'You are a test agent.'
    },
    provider: mockProvider,
    veilStateManager: veilState
  });
  
  space.addEffector(new AgentEffector(agentElement, agent));
  
  console.log('1. Sending console input...\n');
  
  await space.emit({
    topic: 'console:input',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: { input: 'Hello' }
  });
  
  await new Promise(resolve => setTimeout(resolve, 300));
  
  console.log('\n2. Examining frame history:');
  
  const state = veilState.getState();
  console.log(`Total frames: ${state.frameHistory.length}\n`);
  
  for (let i = 0; i < state.frameHistory.length; i++) {
    const frame = state.frameHistory[i];
    console.log(`Frame ${i + 1} (sequence ${frame.sequence}):`);
    console.log(`- Timestamp: ${new Date(frame.timestamp).toISOString()}`);
    console.log(`- Events: ${frame.events.length}`);
    
    if (frame.events.length > 0) {
      for (const event of frame.events) {
        console.log(`  - ${event.topic} from ${event.source?.elementId || 'unknown'}`);
      }
    } else {
      console.log('  (no events)');
    }
    
    console.log(`- Deltas: ${frame.deltas.length}`);
    for (const delta of frame.deltas) {
      if (delta.type === 'addFacet') {
        console.log(`  - add ${delta.facet.type}`);
      } else {
        console.log(`  - ${delta.type}`);
      }
    }
    
    console.log();
  }
  
  console.log('3. Issue diagnosis:');
  console.log('If all frames have empty events arrays, getFrameSource will return "system"');
  console.log('This explains why all messages are marked with system role.');
}

main().catch(console.error);
