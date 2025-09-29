import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { VEILOperationReceptor } from '../src/spaces/migration-adapters';
import { 
  ConsoleInputReceptor, 
  ConsoleOutputEffector 
} from '../src/components/console-receptors';
import { 
  ContextTransform 
} from '../src/hud/context-transform';
import { 
  AgentEffector,
  MockLLMProvider,
  AgentElement
} from '../src';
import {
  PersistenceMaintainer,
  PersistenceMaintainerConfig,
  TransitionMaintainer
} from '../src/persistence';

async function main() {
  console.log('=== Testing Persistence with Maintainers ===\n');
  
  // Setup
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Add receptors, transforms, effectors
  space.addReceptor(new VEILOperationReceptor());
  space.addReceptor(new ConsoleInputReceptor());
  space.addTransform(new ContextTransform(veilState));
  space.addEffector(new ConsoleOutputEffector());
  
  // Add persistence maintainers
  const persistenceMaintainer = new PersistenceMaintainer(veilState, {
    storagePath: './test-persistence',
    snapshotInterval: 5, // Every 5 frames for testing
    maxDeltasPerFile: 10
  });
  space.addMaintainer(persistenceMaintainer);
  
  const transitionMaintainer = new TransitionMaintainer(veilState, {
    storagePath: './test-transitions',
    snapshotInterval: 3 // Every 3 transitions for testing
  });
  space.addMaintainer(transitionMaintainer);
  
  // Create agent
  const agentElement = new AgentElement('test-agent');
  space.addChild(agentElement);
  
  const mockProvider = new MockLLMProvider([
    { pattern: /hello/i, response: "Hello! The persistence system is working." },
    { pattern: /test/i, response: "I'm tracking all our conversations in the persistence layer." }
  ]);
  
  space.addEffector(new AgentEffector(agentElement, mockProvider));
  
  console.log('1. Sending test messages...\n');
  
  // Send some messages to generate frames
  const messages = ['hello', 'test persistence', 'another message'];
  
  for (const msg of messages) {
    console.log(`User: ${msg}`);
    await space.emit({
      topic: 'console:input',
      source: space.getRef(),
      timestamp: Date.now(),
      payload: { input: msg }
    });
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('\n2. Checking VEIL state:');
  const state = veilState.getState();
  console.log(`Total frames: ${state.currentSequence}`);
  console.log(`Total facets: ${state.facets.size}`);
  
  console.log('\n3. Persistence should have created:');
  console.log('- Delta files in ./test-persistence/');
  console.log('- Snapshot files in ./test-persistence/');
  console.log('- Transition files in ./test-transitions/');
  
  console.log('\nDone! Check the output directories for persisted data.');
}

main().catch(console.error);
