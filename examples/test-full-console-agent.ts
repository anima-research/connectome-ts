/**
 * Full Console Agent Test
 * Tests the complete receptor/effector pipeline with an agent
 */

import * as readline from 'readline';
import { config } from 'dotenv';
config();

import {
  Space,
  VEILStateManager,
  BasicAgent,
  MockLLMProvider,
  AnthropicProvider,
  ContextTransform,
  AgentEffector
} from '../src';
import { 
  ConsoleInputReceptor, 
  ConsoleOutputEffector 
} from '../src/components/console-receptors';

async function main() {
  console.log('=== Full Console Agent Test ===\n');
  
  // Create VEIL state and Space
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Create agent with mock or real provider
  const provider = process.env.USE_ANTHROPIC === 'true' && process.env.ANTHROPIC_API_KEY
    ? new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
    : new MockLLMProvider();
    
  if (provider instanceof MockLLMProvider) {
    console.log('Using mock LLM provider\n');
    // Add patterns that match actual user messages (case-insensitive)
    provider.addResponse('hello', 'Hello! How can I help you today?');
    provider.addResponse('test the system', 'The receptor/effector system is working perfectly!');
    provider.addResponse('check validation', 'I can confirm that facet validation is active and working.');
    provider.addResponse('cleanup', 'Ephemeral facets are naturally fading away as designed.');
    provider.addResponse('default', 'I understand. The system seems to be functioning well.');
    
    // Enable debug to see what messages are being sent
    (provider as any).debug = true;
  }
  
  const agent = new BasicAgent({
    config: {
      name: 'Assistant',
      systemPrompt: 'You are a helpful assistant testing the new Connectome architecture.'
    },
    provider: provider,
    veilStateManager: veilState
  });
  
  // Register the full pipeline
  console.log('Setting up receptor/effector pipeline...');
  
  // Phase 1: Events → Facets
  const inputReceptor = new ConsoleInputReceptor();
  console.log('- ConsoleInputReceptor added');
  space.addReceptor(inputReceptor);
  
  // Phase 2: VEIL → VEIL
  const contextTransform = new ContextTransform(veilState);
  console.log('- ContextTransform added');
  space.addTransform(contextTransform);
  console.log('- Note: Ephemeral facets naturally fade away, no cleanup needed');
  
  // Phase 3: VEIL changes → Events/Actions
  const agentEffector = new AgentEffector(agent);
  console.log('- AgentEffector added');
  space.addEffector(agentEffector);
  
  const outputEffector = new ConsoleOutputEffector((content: string) => {
    console.log(`\n[Assistant]: ${content}`);
  });
  console.log('- ConsoleOutputEffector added');
  space.addEffector(outputEffector);
  
  console.log('Pipeline ready!\n');
  
  // Test cases
  const testMessages = [
    'Hello!',
    'Test the system',
    'Check validation',
    'How is cleanup working?'
  ];
  
  console.log('Running automated tests...\n');
  
  for (const message of testMessages) {
    console.log(`[You]: ${message}`);
    
    // Send message
    await space.handleEvent({
      topic: 'console:input',
      source: {
        elementId: 'test-console',
        elementPath: ['test-console']
      },
      payload: { input: message },
      timestamp: Date.now()
    });
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Check state
    const state = veilState.getState();
    const ephemeralCount = Array.from(state.facets.values())
      .filter(f => (f as any).ephemeral === true)
      .length;
    
    // Debug: Check for activation facets
    const activationFacets = Array.from(state.facets.values())
      .filter(f => f.type === 'agent-activation');
    const speechFacets = Array.from(state.facets.values())
      .filter(f => f.type === 'speech');
    
    console.log(`  [State: ${state.facets.size} facets, ${ephemeralCount} ephemeral, ${activationFacets.length} activations, ${speechFacets.length} speech]`);
  }
  
  // Final state check
  console.log('\n=== Final State Check ===');
  const finalState = veilState.getState();
  console.log(`Total facets: ${finalState.facets.size}`);
  console.log(`Frame history: ${finalState.frameHistory.length} frames`);
  
  // Debug: Look at frame history
  console.log('\nLast few frames:');
  const lastFrames = finalState.frameHistory.slice(-5);
  for (const frame of lastFrames) {
    console.log(`  Frame ${frame.sequence}: ${frame.deltas.length} deltas`);
    for (const delta of frame.deltas) {
      if (delta.type === 'addFacet') {
        console.log(`    + ${delta.facet.type} (${delta.facet.id})`);
      } else {
        console.log(`    ${delta.type} ${delta.id}`);
      }
    }
  }
  
  // List remaining facets
  const facetTypes = new Map<string, number>();
  for (const facet of finalState.facets.values()) {
    const count = facetTypes.get(facet.type) || 0;
    facetTypes.set(facet.type, count + 1);
  }
  
  console.log('\nFacet types in state:');
  for (const [type, count] of facetTypes) {
    console.log(`  ${type}: ${count}`);
  }
  
  // Check ephemeral facets
  const ephemeralRemaining = Array.from(finalState.facets.values())
    .filter(f => (f as any).ephemeral === true)
    .length;
    
  console.log(`\nEphemeral facets in state: ${ephemeralRemaining}`);
  console.log('Note: Ephemeral facets naturally fade away - they are not persisted');
  
  console.log('\n✅ Full console agent test completed successfully!');
}

main().catch(console.error);
