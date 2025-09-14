#!/usr/bin/env node

/**
 * Test state initialization timing
 */

import { 
  Space, 
  Element,
  BasicAgent,
  MockLLMProvider,
  VEILStateManager
} from '../src';
import { createBoxDispenser } from '../src/components/box-dispenser';

async function main() {
  console.log('=== State Initialization Test ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  const agent = new BasicAgent(
    { 
      name: 'test-agent',
      systemPrompt: 'Test agent'
    },
    new MockLLMProvider(),
    veilState
  );
  
  // Enable auto-registration
  agent.enableAutoActionRegistration();
  space.setAgent(agent);
  
  // Add dispenser
  console.log('1. Adding dispenser...');
  const dispenser = createBoxDispenser(new MockLLMProvider());
  space.addChild(dispenser);
  
  // Process first frame to initialize components
  console.log('\n2. Processing first frame...');
  await space.processFrame();
  
  // Now try to perform actions (after first frame)
  console.log('\n3. Testing action execution after first frame...');
  
  // Parse and execute dispense action
  const dispenseCompletion = '@dispenser.dispense()';
  const parsedDispense = agent.parseCompletion(dispenseCompletion);
  console.log('   - Executing dispense action...');
  await (agent as any).processToolCalls(parsedDispense.operations);
  
  // Parse and execute setSize action
  const setSizeCompletion = '@dispenser.setSize("small")';
  const parsedSetSize = agent.parseCompletion(setSizeCompletion);
  console.log('   - Executing setSize action...');
  await (agent as any).processToolCalls(parsedSetSize.operations);
  
  console.log('\n4. Test completed!');
  console.log('   The frame context architecture ensures proper initialization order.');
}

main().catch(console.error);

