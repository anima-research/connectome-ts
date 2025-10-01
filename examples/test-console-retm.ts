/**
 * Test Console RETM Architecture
 * 
 * Tests the new ConsoleAfferent + Receptors/Effectors implementation
 * This is the architecturally correct way to handle console input.
 */

import {
  Space,
  Element,
  VEILStateManager,
  ConsoleAfferent,
  ConsoleMessageReceptor,
  ConsoleSpeechEffector,
  AgentEffector,
  BasicAgent,
  MockLLMProvider,
  ContextTransform
} from '../src';
import { AfferentContext } from '../src/spaces/receptor-effector-types';

async function main() {
  console.log('=== Console RETM Architecture Test ===\n');
  
  // Setup
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Create console element
  const consoleElem = new Element('console');
  space.addChild(consoleElem);
  
  // Create and setup console afferent
  const consoleAfferent = new ConsoleAfferent();
  await consoleElem.addComponentAsync(consoleAfferent);
  
  // Create afferent context
  const context: AfferentContext<any> = {
    config: {
      prompt: '> ',
      streamId: 'console:main'
    },
    afferentId: 'console-main',
    emit: (event) => space.emit(event),
    emitError: (error) => console.error('[ConsoleAfferent Error]:', error)
  };
  
  // Initialize and start the afferent
  await consoleAfferent.initialize(context);
  await consoleAfferent.start();
  
  // Add receptor
  space.addReceptor(new ConsoleMessageReceptor());
  
  // Add speech effector
  space.addEffector(new ConsoleSpeechEffector(consoleAfferent));
  
  // Create agent
  const agentElem = new Element('agent');
  space.addChild(agentElem);
  
  const mockProvider = new MockLLMProvider();
  mockProvider.setResponses([
    "Hello! I'm here and ready to chat!",
    "That's an interesting point. Let me think about it...",
    "I understand. How can I help you further?",
    "Goodbye! It was nice chatting with you."
  ]);
  
  const agent = new BasicAgent({
    name: 'TestAgent',
    systemPrompt: 'You are a helpful AI assistant.',
    llmProvider: mockProvider
  });
  
  // Add agent effector and context transform
  space.addEffector(new AgentEffector(agentElem, agent));
  space.addTransform(new ContextTransform(veilState));
  
  console.log('✅ Console RETM architecture initialized');
  console.log('📝 Type messages to test the system');
  console.log('💡 Use /quit to exit, /sleep to test sleep mode\n');
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n[Test] Shutting down...');
    await consoleAfferent.stop();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

