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
  BasicAgent,
  AgentElement,
  hasContentAspect,
  RenderedContextFacet,
  Facet
} from '../src';

async function main() {
  console.log('=== Testing Rendered Context Generation (Debug) ===\n');
  
  // Setup
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Add receptors, transforms, effectors
  space.addReceptor(new VEILOperationReceptor());
  space.addReceptor(new ConsoleInputReceptor());
  space.addTransform(new ContextTransform(veilState));
  space.addEffector(new ConsoleOutputEffector((content) => {
    console.log(`[Console Output]: ${content}\n`);
  }));
  
  // Create agent
  const agentElement = new AgentElement('test-agent');
  space.addChild(agentElement);
  
  const mockProvider = new MockLLMProvider();
  // Use sequential responses
  mockProvider.setResponses([
    "Hello! I'm here to help you test the context system.",
    "I can see our conversation history. Let me check the context.",
    "The rendered context should contain our full conversation."
  ]);
  
  const agent = new BasicAgent({
    config: {
      name: 'TestAgent',
      systemPrompt: 'You are a test agent for verifying context rendering.'
    },
    provider: mockProvider,
    veilStateManager: veilState
  });
  
  space.addEffector(new AgentEffector(agentElement, agent));
  
  console.log('1. Initial state check:');
  console.log(`- Space active: ${space.active}`);
  console.log(`- Agent element active: ${agentElement.active}`);
  console.log(`- Agent element has parent: ${agentElement.parent !== null}`);
  console.log(`- Agent element ID: ${agentElement.id}`);
  
  console.log('\n2. Sending first message...\n');
  
  // Send first message
  await space.emit({
    topic: 'console:input',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: { input: 'hello agent' }
  });
  
  await new Promise(resolve => setTimeout(resolve, 300));
  
  // Check facets after first message
  console.log('\n3. Facets after first message:');
  const state1 = veilState.getState();
  const facetTypes1 = new Map<string, number>();
  const activationFacets: Facet[] = [];
  
  for (const [id, facet] of state1.facets) {
    const count = facetTypes1.get(facet.type) || 0;
    facetTypes1.set(facet.type, count + 1);
    
    if (facet.type === 'agent-activation') {
      activationFacets.push(facet);
      console.log(`- Found agent-activation facet: ${id}`);
    }
  }
  
  console.log('\nFacet counts:');
  for (const [type, count] of facetTypes1) {
    console.log(`  ${type}: ${count}`);
  }
  
  console.log('\n4. Sending second message...\n');
  
  // Send second message
  await space.emit({
    topic: 'console:input',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: { input: 'can you see the context?' }
  });
  
  await new Promise(resolve => setTimeout(resolve, 300));
  
  console.log('\n5. Checking for rendered-context facets...\n');
  
  // Find all rendered-context facets
  const state2 = veilState.getState();
  const contextFacets: RenderedContextFacet[] = [];
  const allFacetTypes = new Map<string, number>();
  
  for (const [id, facet] of state2.facets) {
    const count = allFacetTypes.get(facet.type) || 0;
    allFacetTypes.set(facet.type, count + 1);
    
    if (facet.type === 'rendered-context') {
      contextFacets.push(facet as RenderedContextFacet);
      console.log(`Found rendered-context facet: ${id}`);
      console.log(`- Activation ID: ${facet.state.activationId}`);
      console.log(`- Token count: ${facet.state.tokenCount}`);
    }
  }
  
  console.log(`\nTotal rendered-context facets: ${contextFacets.length}`);
  
  // Examine the context structure
  if (contextFacets.length > 0) {
    const latestContext = contextFacets[contextFacets.length - 1];
    console.log('\n6. Latest context details:');
    
    if (latestContext.state.context) {
      const context = latestContext.state.context;
      console.log('Context structure:');
      console.log(`- Type: ${typeof context}`);
      console.log(`- Has messages: ${context.messages ? 'yes' : 'no'}`);
      
      if (context.messages && Array.isArray(context.messages)) {
        console.log(`- Message count: ${context.messages.length}`);
        console.log('\nMessages:');
        for (let i = 0; i < context.messages.length; i++) {
          const msg = context.messages[i];
          console.log(`  ${i + 1}. [${msg.role}]: ${msg.content.substring(0, 60)}...`);
        }
      }
    }
  } else {
    console.log('\n6. Debugging why no context was created:');
    console.log('- Checking for agent-activation facets...');
    
    let hasActivation = false;
    for (const [id, facet] of state2.facets) {
      if (facet.type === 'agent-activation') {
        hasActivation = true;
        console.log(`  Found activation: ${id}`);
      }
    }
    
    if (!hasActivation) {
      console.log('  ERROR: No agent-activation facets found!');
      console.log('  This is why ContextTransform is not creating contexts.');
    }
  }
  
  console.log('\n7. Final summary:');
  console.log(`- Total frames: ${state2.currentSequence}`);
  console.log(`- Total facets: ${state2.facets.size}`);
  console.log('\nAll facet types:');
  for (const [type, count] of allFacetTypes) {
    console.log(`  ${type}: ${count}`);
  }
}

main().catch(console.error);
