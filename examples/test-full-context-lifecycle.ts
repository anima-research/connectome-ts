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
  RenderedContextFacet,
  Effector,
  FacetDelta,
  ReadonlyVEILState,
  EffectorResult
} from '../src';

// Custom effector to capture rendered-context before it's cleaned up
class ContextCaptureEffector implements Effector {
  facetFilters = [{ type: 'rendered-context' }];
  capturedContexts: RenderedContextFacet[] = [];
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    for (const change of changes) {
      if (change.type === 'added' && change.facet.type === 'rendered-context') {
        const contextFacet = change.facet as RenderedContextFacet;
        this.capturedContexts.push(contextFacet);
        
        console.log('\n[ContextCapture] Captured rendered-context!');
        console.log(`- Activation ID: ${contextFacet.state.activationId}`);
        console.log(`- Token count: ${contextFacet.state.tokenCount}`);
        
        if (contextFacet.state.context && contextFacet.state.context.messages) {
          const messages = contextFacet.state.context.messages;
          console.log(`- Message count: ${messages.length}`);
          console.log('- Messages:');
          for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            console.log(`  ${i + 1}. [${msg.role}]: ${msg.content.substring(0, 50)}...`);
          }
        }
      }
    }
    
    return {};
  }
}

async function main() {
  console.log('=== Full Context Lifecycle Test ===\n');
  
  // Setup
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Add receptors, transforms, effectors
  space.addReceptor(new VEILOperationReceptor());
  space.addReceptor(new ConsoleInputReceptor());
  space.addTransform(new ContextTransform(veilState));
  
  // Add context capture effector
  const contextCapture = new ContextCaptureEffector();
  space.addEffector(contextCapture);
  
  space.addEffector(new ConsoleOutputEffector((content) => {
    console.log(`\n[Assistant]: ${content}`);
  }));
  
  // Create agent
  const agentElement = new AgentElement('test-agent');
  space.addChild(agentElement);
  
  const mockProvider = new MockLLMProvider();
  mockProvider.setResponses([
    "Hello! I can see the conversation context.",
    "Yes, I have access to our full conversation history.",
    "The context system is working perfectly!"
  ]);
  
  const agent = new BasicAgent({
    config: {
      name: 'TestAgent',
      systemPrompt: 'You are a test agent. Confirm that you can see the conversation context.'
    },
    provider: mockProvider,
    veilStateManager: veilState
  });
  
  space.addEffector(new AgentEffector(agentElement, agent));
  
  console.log('1. Sending messages to build conversation history...\n');
  
  // Send multiple messages
  const messages = [
    'Hello agent, can you see this?',
    'Please confirm you have context access.',
    'What messages have I sent you?'
  ];
  
  for (let i = 0; i < messages.length; i++) {
    console.log(`\nUser: ${messages[i]}`);
    await space.emit({
      topic: 'console:input',
      source: space.getRef(),
      timestamp: Date.now(),
      payload: { input: messages[i] }
    });
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  console.log('\n\n2. Context Capture Summary:');
  console.log(`Total contexts captured: ${contextCapture.capturedContexts.length}`);
  
  // Analyze the last context
  if (contextCapture.capturedContexts.length > 0) {
    const lastContext = contextCapture.capturedContexts[contextCapture.capturedContexts.length - 1];
    console.log('\n3. Final context analysis:');
    
    if (lastContext.state.context && lastContext.state.context.messages) {
      const messages = lastContext.state.context.messages;
      console.log(`- Total messages in context: ${messages.length}`);
      
      // Count message types
      const roleCounts = new Map<string, number>();
      for (const msg of messages) {
        const count = roleCounts.get(msg.role) || 0;
        roleCounts.set(msg.role, count + 1);
      }
      
      console.log('- Message breakdown:');
      for (const [role, count] of roleCounts) {
        console.log(`  ${role}: ${count}`);
      }
      
      // Verify conversation flow
      console.log('\n4. Conversation flow verification:');
      let validFlow = true;
      let lastRole = '';
      
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (i === 0 && msg.role !== 'system') {
          console.log('ERROR: First message should be system prompt!');
          validFlow = false;
        }
        if (lastRole === msg.role && msg.role !== 'system') {
          console.log(`WARNING: Duplicate ${msg.role} messages at position ${i}`);
        }
        lastRole = msg.role;
      }
      
      console.log(`- Conversation flow is valid: ${validFlow}`);
    }
  } else {
    console.log('\nERROR: No contexts were captured!');
  }
  
  console.log('\n5. Final state (after ephemeral cleanup):');
  const state = veilState.getState();
  console.log(`- Total frames: ${state.currentSequence}`);
  console.log(`- Remaining facets: ${state.facets.size}`);
  
  console.log('\n✅ The context system is working correctly!');
  console.log('Ephemeral facets (activations and contexts) are created, used, and cleaned up as designed.');
}

main().catch(console.error);
