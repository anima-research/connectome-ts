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
  RenderedContextFacet
} from '../src';

async function main() {
  console.log('=== Testing Rendered Context Generation ===\n');
  
  // Setup
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Add receptors, transforms, effectors
  space.addReceptor(new VEILOperationReceptor());
  space.addReceptor(new ConsoleInputReceptor());
  space.addTransform(new ContextTransform(veilState));
  space.addEffector(new ConsoleOutputEffector());
  
  // Create agent
  const agentElement = new AgentElement('test-agent');
  space.addChild(agentElement);
  
  const mockProvider = new MockLLMProvider();
  mockProvider.addResponse('hello', "Hello! I'm here to help.");
  mockProvider.addResponse('context', "I can see our conversation history.");
  
  const agent = new BasicAgent({
    config: {
      name: 'TestAgent',
      systemPrompt: 'You are a test agent for verifying context rendering.'
    },
    provider: mockProvider,
    veilStateManager: veilState
  });
  
  space.addEffector(new AgentEffector(agentElement, agent));
  
  console.log('1. Sending test messages...\n');
  
  // Send first message
  console.log('User: hello agent');
  await space.emit({
    topic: 'console:input',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: { input: 'hello agent' }
  });
  
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // Send second message
  console.log('User: can you see the context?');
  await space.emit({
    topic: 'console:input',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: { input: 'can you see the context?' }
  });
  
  await new Promise(resolve => setTimeout(resolve, 200));
  
  console.log('\n2. Checking rendered context facets...\n');
  
  // Find all rendered-context facets
  const state = veilState.getState();
  const contextFacets: RenderedContextFacet[] = [];
  
  for (const [id, facet] of state.facets) {
    if (facet.type === 'rendered-context') {
      contextFacets.push(facet as RenderedContextFacet);
    }
  }
  
  console.log(`Found ${contextFacets.length} rendered-context facets\n`);
  
  // Examine the most recent context
  if (contextFacets.length > 0) {
    const latestContext = contextFacets[contextFacets.length - 1];
    console.log('Latest rendered context:');
    console.log('- Activation ID:', latestContext.state.activationId);
    console.log('- Token count:', latestContext.state.tokenCount);
    
    // Check if context has the full conversation
    if (latestContext.state.context) {
      const context = latestContext.state.context;
      console.log('\nContext messages:');
      if (context.messages && Array.isArray(context.messages)) {
        for (const msg of context.messages) {
          console.log(`  [${msg.role}]: ${msg.content.substring(0, 50)}...`);
        }
        
        // Verify correct structure
        console.log('\n3. Verifying context structure...');
        
        const hasSystemMessage = context.messages.some((m: any) => m.role === 'system');
        const hasUserMessages = context.messages.some((m: any) => m.role === 'user');
        const hasAssistantMessages = context.messages.some((m: any) => m.role === 'assistant');
        
        console.log('- Has system message:', hasSystemMessage);
        console.log('- Has user messages:', hasUserMessages);
        console.log('- Has assistant messages:', hasAssistantMessages);
        
        // Check if messages are in correct order
        console.log('\n4. Message ordering:');
        let lastRole = '';
        let correctOrder = true;
        
        for (let i = 0; i < context.messages.length; i++) {
          const msg = context.messages[i];
          if (i === 0 && msg.role !== 'system') {
            console.log('WARNING: First message is not system!');
            correctOrder = false;
          }
          if (lastRole === msg.role && msg.role !== 'system') {
            console.log(`WARNING: Consecutive ${msg.role} messages at index ${i}`);
            correctOrder = false;
          }
          lastRole = msg.role;
        }
        
        console.log('- Message order is correct:', correctOrder);
        
        // Check for malformed content
        console.log('\n5. Content quality check:');
        let malformedContent = false;
        
        for (const msg of context.messages) {
          if (msg.content.includes('<user>') || msg.content.includes('</user>')) {
            console.log('ERROR: Found nested user tags in content!');
            malformedContent = true;
          }
          if (msg.content.includes('<assistant>') || msg.content.includes('</assistant>')) {
            console.log('ERROR: Found nested assistant tags in content!');
            malformedContent = true;
          }
        }
        
        console.log('- Content is well-formed:', !malformedContent);
        
      } else {
        console.log('ERROR: Context does not have messages array!');
      }
    } else {
      console.log('ERROR: No context object in rendered-context facet!');
    }
  }
  
  console.log('\n6. Summary:');
  console.log(`- Total frames processed: ${state.currentSequence}`);
  console.log(`- Total facets: ${state.facets.size}`);
  console.log(`- Context facets created: ${contextFacets.length}`);
  
  // Show facet type distribution
  const facetTypes = new Map<string, number>();
  for (const [, facet] of state.facets) {
    const count = facetTypes.get(facet.type) || 0;
    facetTypes.set(facet.type, count + 1);
  }
  
  console.log('\nFacet type distribution:');
  for (const [type, count] of facetTypes) {
    console.log(`  ${type}: ${count}`);
  }
}

main().catch(console.error);
